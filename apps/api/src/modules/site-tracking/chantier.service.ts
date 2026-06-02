import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { isTransferable } from '../estimating/affaire-workflow';
import {
  CalcComponent,
  CalcOuvrage,
  NATURES,
  computeNatureBreakdownMap,
} from '../estimating/ouvrage-calc';
import { VenteService } from '../estimating/vente.service';
import { BUDGET_NATURES, BudgetNature } from './budget-nature';

interface OuvrageComp {
  kind: string;
  child_resource_id: string | null;
  child_ouvrage_id: string | null;
  quantity: string | null;
  rate: string | null;
}

@Injectable()
export class ChantierService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly vente: VenteService,
  ) {}

  /** Transfers a won affaire into a chantier, materialising the déboursé hierarchy. */
  async transferFromAffaire(affaireId: string) {
    const tenantId = this.context.requireTenantId();

    const affaire = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT id, code, name, status FROM affaire WHERE id = $1`, [affaireId]),
    );
    if (affaire.length === 0) {
      throw new NotFoundException(`Unknown affaire "${affaireId}"`);
    }
    if (!isTransferable(affaire[0].status)) {
      throw new ConflictException('Only a won affaire can be transferred.');
    }
    const versionRow = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT id FROM affaire_version WHERE affaire_id = $1 ORDER BY version_no DESC LIMIT 1`,
        [affaireId],
      ),
    );
    if (versionRow.length === 0) {
      throw new ConflictException('Affaire has no version to transfer.');
    }
    const versionId = versionRow[0].id as string;
    const venteTotal = (await this.vente.computeForVersion(versionId)).totalPvHt;

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const current = await em.query(`SELECT status FROM affaire WHERE id = $1 FOR UPDATE`, [affaireId]);
      if (!isTransferable(current[0].status)) {
        throw new ConflictException('Only a won affaire can be transferred.');
      }
      if ((await em.query(`SELECT id FROM chantier WHERE affaire_version_id = $1`, [versionId])).length > 0) {
        throw new ConflictException('This affaire version already has a chantier.');
      }

      const marche = await em.query(`SELECT id FROM marche WHERE affaire_version_id = $1`, [versionId]);
      const chantier = (
        await em.query(
          `INSERT INTO chantier (tenant_id, code, name, affaire_id, affaire_version_id, marche_id, budget_vente_ht)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [tenantId, `${affaire[0].code}-CH`, affaire[0].name, affaireId, versionId,
            marche.length > 0 ? marche[0].id : null, venteTotal],
        )
      )[0];

      // In-memory ouvrage graph for materialisation.
      const compByOuvrage = new Map<string, OuvrageComp[]>();
      for (const c of await em.query(
        `SELECT parent_ouvrage_id, kind, child_resource_id, child_ouvrage_id, quantity, rate
           FROM ouvrage_component ORDER BY sort_order ASC`,
      )) {
        const arr = compByOuvrage.get(c.parent_ouvrage_id) ?? [];
        arr.push(c);
        compByOuvrage.set(c.parent_ouvrage_id, arr);
      }
      const ouvById = new Map<string, { code: string; label: string; unit: string }>();
      for (const o of await em.query(`SELECT id, code, label, unit FROM ouvrage`)) {
        ouvById.set(o.id, o);
      }
      const resById = new Map<string, { code: string; label: string; unit: string; nature: string; unit_cost: string }>();
      for (const r of await em.query(`SELECT id, code, label, unit, nature, unit_cost FROM resource`)) {
        resById.set(r.id, r);
      }
      const nomencByResource = new Map<string, string>();

      const ensureNomenclature = async (resourceId: string): Promise<string> => {
        const cached = nomencByResource.get(resourceId);
        if (cached) return cached;
        const r = resById.get(resourceId)!;
        const row = (
          await em.query(
            `INSERT INTO nomenclature_resource
               (tenant_id, chantier_id, source_resource_id, code, label, unit, nature, unit_cost_etude, unit_cost_objectif)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
            [tenantId, chantier.id, resourceId, r.code, r.label, r.unit, r.nature, r.unit_cost],
          )
        )[0];
        nomencByResource.set(resourceId, row.id);
        return row.id;
      };

      const materialize = async (
        ouvrageId: string,
        parentLineId: string | null,
        vendable: boolean,
        sourceDevisLineId: string | null,
        quantite: string,
        meta: { code: string | null; designation: string; unit: string | null },
        sortOrder: number,
      ): Promise<string> => {
        const line = (
          await em.query(
            `INSERT INTO execution_line
               (tenant_id, chantier_id, parent_line_id, type, vendable, code, designation, unit,
                source_devis_line_id, source_ouvrage_id, quantite_etude, quantite_objectif,
                debourse_unitaire_etude, debourse_unitaire_objectif, sort_order)
             VALUES ($1,$2,$3,'ouvrage',$4,$5,$6,$7,$8,$9,$10,$10,0,0,$11) RETURNING id`,
            [tenantId, chantier.id, parentLineId, vendable, meta.code, meta.designation, meta.unit,
              sourceDevisLineId, ouvrageId, quantite, sortOrder],
          )
        )[0];

        let cSort = 0;
        for (const comp of compByOuvrage.get(ouvrageId) ?? []) {
          if (comp.kind === 'resource' && comp.child_resource_id) {
            const nomencId = await ensureNomenclature(comp.child_resource_id);
            await em.query(
              `INSERT INTO execution_component
                 (tenant_id, execution_line_id, kind, nomenclature_resource_id, quantite_etude, quantite_objectif, sort_order)
               VALUES ($1,$2,'resource',$3,$4,$4,$5)`,
              [tenantId, line.id, nomencId, comp.quantity ?? '0', cSort++],
            );
          } else if (comp.kind === 'sub_ouvrage' && comp.child_ouvrage_id) {
            const child = ouvById.get(comp.child_ouvrage_id);
            const childLineId = await materialize(
              comp.child_ouvrage_id, line.id, true, null, '1',
              { code: child?.code ?? null, designation: child?.label ?? 'Sous-ouvrage', unit: child?.unit ?? null },
              cSort,
            );
            await em.query(
              `INSERT INTO execution_component
                 (tenant_id, execution_line_id, kind, child_line_id, quantite_etude, quantite_objectif, sort_order)
               VALUES ($1,$2,'sub_line',$3,$4,$4,$5)`,
              [tenantId, line.id, childLineId, comp.quantity ?? '0', cSort++],
            );
          } else if (comp.kind === 'percentage') {
            await em.query(
              `INSERT INTO execution_component (tenant_id, execution_line_id, kind, rate, sort_order)
               VALUES ($1,$2,'percentage',$3,$4)`,
              [tenantId, line.id, comp.rate ?? '0', cSort++],
            );
          }
        }
        return line.id;
      };

      const devisLines = await em.query(
        `SELECT id, code, designation, unit, quantity, vendable, source_ouvrage_id
           FROM devis_line
          WHERE affaire_version_id = $1 AND type = 'ouvrage' AND source_ouvrage_id IS NOT NULL
          ORDER BY sort_order ASC, created_at ASC`,
        [versionId],
      );
      let top = 0;
      for (const dl of devisLines) {
        await materialize(dl.source_ouvrage_id, null, dl.vendable, dl.id, dl.quantity ?? '0',
          { code: dl.code, designation: dl.designation, unit: dl.unit }, top++);
      }

      await this.recompute(em, tenantId, chantier.id, true);
      return { chantier, lineCount: devisLines.length };
    });
  }

  /** Recomputes the objectif budget by nature for every top line (étude too when freeze). */
  private async recompute(
    em: EntityManager,
    tenantId: string,
    chantierId: string,
    freeze: boolean,
  ): Promise<void> {
    const lines = await em.query(
      `SELECT id, parent_line_id, vendable, quantite_objectif FROM execution_line WHERE chantier_id = $1`,
      [chantierId],
    );
    const comps = await em.query(
      `SELECT ec.execution_line_id, ec.kind, ec.child_line_id, ec.quantite_objectif, ec.rate,
              n.nature, n.unit_cost_objectif
         FROM execution_component ec
         JOIN execution_line el ON el.id = ec.execution_line_id
         LEFT JOIN nomenclature_resource n ON n.id = ec.nomenclature_resource_id
        WHERE el.chantier_id = $1`,
      [chantierId],
    );
    const map = new Map<string, CalcOuvrage>();
    for (const l of lines) map.set(l.id, { id: l.id, components: [] });
    for (const c of comps) {
      const parent = map.get(c.execution_line_id);
      if (!parent) continue;
      const comp: CalcComponent = { kind: c.kind === 'sub_line' ? 'sub_ouvrage' : c.kind };
      if (c.kind === 'resource') {
        comp.quantity = c.quantite_objectif ?? 0;
        comp.unitCost = c.unit_cost_objectif ?? 0;
        comp.nature = c.nature ?? 'material';
      } else if (c.kind === 'sub_line') {
        comp.quantity = c.quantite_objectif ?? 0;
        comp.childOuvrageId = c.child_line_id;
      } else {
        comp.rate = c.rate ?? 0;
      }
      parent.components.push(comp);
    }
    const breakdown = computeNatureBreakdownMap(map);

    const debourseClause = freeze
      ? 'debourse_unitaire_objectif = $1, debourse_unitaire_etude = $1'
      : 'debourse_unitaire_objectif = $1';
    const budgetSet = freeze
      ? 'montant_objectif = EXCLUDED.montant_objectif, montant_etude = EXCLUDED.montant_objectif'
      : 'montant_objectif = EXCLUDED.montant_objectif';

    for (const l of lines) {
      if (l.parent_line_id) continue; // budget only on top lines
      const unit = breakdown.get(l.id)!;
      const qty = new Decimal(l.quantite_objectif ?? 0);
      const totalUnit = NATURES.reduce((a, n) => a.plus(unit[n]), new Decimal(0));
      const amounts: Record<BudgetNature, Decimal> = {
        labor: new Decimal(0), material: new Decimal(0), equipment: new Decimal(0),
        subcontract: new Decimal(0), site_overhead: new Decimal(0),
      };
      if (l.vendable) {
        for (const n of NATURES) amounts[n] = unit[n].times(qty);
      } else {
        amounts.site_overhead = totalUnit.times(qty);
      }
      await em.query(
        `UPDATE execution_line SET ${debourseClause}, updated_at = now() WHERE id = $2`,
        [totalUnit.toDecimalPlaces(4).toString(), l.id],
      );
      for (const nature of BUDGET_NATURES) {
        const montant = amounts[nature].toDecimalPlaces(2).toString();
        await em.query(
          `INSERT INTO execution_line_budget (tenant_id, execution_line_id, nature, montant_etude, montant_objectif)
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (execution_line_id, nature) DO UPDATE SET ${budgetSet}`,
          [tenantId, l.id, nature, montant],
        );
      }
    }
  }

  private async assertEditable(em: EntityManager, chantierId: string): Promise<void> {
    const c = await em.query(`SELECT contre_etude_status FROM chantier WHERE id = $1`, [chantierId]);
    if (c.length === 0) throw new NotFoundException(`Unknown chantier "${chantierId}"`);
    if (c[0].contre_etude_status === 'validated') {
      throw new ConflictException('Contre-étude is validated (frozen).');
    }
  }

  /** Renegotiate a resource unit price (contre-étude) and recompute the objectif budget. */
  renegotiateResource(chantierId: string, nomenclatureResourceId: string, unitCostObjectif: string | number) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertEditable(em, chantierId);
      const upd = await em.query(
        `UPDATE nomenclature_resource SET unit_cost_objectif = $1, updated_at = now()
          WHERE id = $2 AND chantier_id = $3 RETURNING id`,
        [String(unitCostObjectif), nomenclatureResourceId, chantierId],
      );
      if (upd.length === 0) throw new NotFoundException('Unknown nomenclature resource');
      await this.recompute(em, tenantId, chantierId, false);
      return this.getChantierInTx(em, chantierId);
    });
  }

  /** Adjust a component quantity (contre-étude) and recompute the objectif budget. */
  setComponentQuantity(componentId: string, quantiteObjectif: string | number) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT el.chantier_id FROM execution_component ec
           JOIN execution_line el ON el.id = ec.execution_line_id WHERE ec.id = $1`,
        [componentId],
      );
      if (rows.length === 0) throw new NotFoundException(`Unknown component "${componentId}"`);
      const chantierId = rows[0].chantier_id;
      await this.assertEditable(em, chantierId);
      await em.query(
        `UPDATE execution_component SET quantite_objectif = $1, updated_at = now() WHERE id = $2`,
        [String(quantiteObjectif), componentId],
      );
      await this.recompute(em, tenantId, chantierId, false);
      return this.getChantierInTx(em, chantierId);
    });
  }

  /** Validate the contre-étude: freeze the objectif as the control "budget initial". */
  validateContreEtude(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const c = await em.query(`SELECT id FROM chantier WHERE id = $1`, [chantierId]);
      if (c.length === 0) throw new NotFoundException(`Unknown chantier "${chantierId}"`);
      await em.query(
        `UPDATE chantier SET contre_etude_status = 'validated', updated_at = now() WHERE id = $1`,
        [chantierId],
      );
      return this.getChantierInTx(em, chantierId);
    });
  }

  getChantier(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) => this.getChantierInTx(em, chantierId));
  }

  private async getChantierInTx(em: EntityManager, chantierId: string) {
    const chantier = await em.query(`SELECT * FROM chantier WHERE id = $1`, [chantierId]);
    if (chantier.length === 0) throw new NotFoundException(`Unknown chantier "${chantierId}"`);
    const lines = await em.query(
      `SELECT * FROM execution_line WHERE chantier_id = $1 AND parent_line_id IS NULL ORDER BY sort_order ASC`,
      [chantierId],
    );
    const budgetByNature = await em.query(
      `SELECT b.nature,
              SUM(b.montant_etude)::numeric(16,2) AS etude,
              SUM(b.montant_objectif)::numeric(16,2) AS objectif
         FROM execution_line_budget b
         JOIN execution_line l ON l.id = b.execution_line_id
        WHERE l.chantier_id = $1 AND l.parent_line_id IS NULL
        GROUP BY b.nature ORDER BY b.nature`,
      [chantierId],
    );
    return { chantier: chantier[0], lines, budgetByNature };
  }

  listChantiers() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM chantier WHERE deleted_at IS NULL ORDER BY created_at DESC`),
    );
  }

  listNomenclature(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM nomenclature_resource WHERE chantier_id = $1 ORDER BY code ASC`, [chantierId]),
    );
  }
}
