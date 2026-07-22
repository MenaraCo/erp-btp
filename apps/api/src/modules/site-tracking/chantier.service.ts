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
import { returningRows } from '../../core/database/returning.util';
import {
  CalcComponent,
  CalcOuvrage,
  NATURES,
  computeNatureBreakdownMap,
} from '../estimating/ouvrage-calc';
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
  ) {}

  /**
   * Creates the marché (the contract, cahier §5.4) rooted on a chantier — existing (aggregate,
   * budget incremented) or new. Guards against double acceptance of a version. The étude
   * d'exécution and the facturation lines are added separately by the callers.
   */
  async createMarche(
    em: EntityManager,
    args: {
      tenantId: string;
      affaire: { id: string; code: string; name: string };
      marcheCode: string;
      marcheName: string;
      versionId: string;
      venteTotal: string;
      targetChantierId?: string | null;
    },
  ) {
    const { tenantId, affaire, marcheCode, marcheName, versionId, venteTotal, targetChantierId } =
      args;
    if ((await em.query(`SELECT id FROM marche WHERE devis_version_id = $1`, [versionId])).length > 0) {
      throw new ConflictException('This affaire version has already been accepted (marché exists).');
    }
    let chantierId: string;
    if (targetChantierId) {
      const found = await em.query(`SELECT id FROM chantier WHERE id = $1 FOR UPDATE`, [targetChantierId]);
      if (found.length === 0) {
        throw new NotFoundException(`Unknown chantier "${targetChantierId}"`);
      }
      chantierId = found[0].id;
      await em.query(
        `UPDATE chantier SET budget_vente_ht = budget_vente_ht + $1, updated_at = now() WHERE id = $2`,
        [venteTotal, chantierId],
      );
    } else {
      chantierId = (
        await em.query(
          `INSERT INTO chantier (tenant_id, code, name, affaire_id, devis_version_id, budget_vente_ht)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [tenantId, `${affaire.code}-CH`, affaire.name, affaire.id, versionId, venteTotal],
        )
      )[0].id;
    }
    return (
      await em.query(
        `INSERT INTO marche
           (tenant_id, affaire_id, devis_version_id, chantier_id, code, name, total_ht,
            execution_form, contre_etude_status, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'by_ouvrage','draft','active') RETURNING *`,
        [tenantId, affaire.id, versionId, chantierId, marcheCode, marcheName, venteTotal],
      )
    )[0];
  }

  /**
   * Materialises the étude d'exécution (déboursé hierarchy) of a marché's affaire version under
   * that marché (cahier §5.5), aggregated at its chantier. Shared by the site-tracking acceptance
   * and the unified invoicing /accept. No-op if the marché already has execution.
   */
  async materialiseExecutionForMarche(marcheId: string): Promise<number> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const marcheRows = await em.query(
        `SELECT chantier_id, devis_version_id FROM marche WHERE id = $1`,
        [marcheId],
      );
      if (marcheRows.length === 0) {
        throw new NotFoundException(`Unknown marché "${marcheId}"`);
      }
      const chantier = { id: marcheRows[0].chantier_id as string };
      const versionId = marcheRows[0].devis_version_id as string;
      if ((await em.query(`SELECT 1 FROM execution_line WHERE marche_id = $1 LIMIT 1`, [marcheId])).length > 0) {
        return 0;
      }

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
      const resById = new Map<
        string,
        { code: string; label: string; unit: string; nature: string; unit_cost: string; code_analytique_id: string | null }
      >();
      for (const r of await em.query(
        `SELECT id, code, label, unit, nature, unit_cost, code_analytique_id FROM resource`,
      )) {
        resById.set(r.id, r);
      }
      const nomencByResource = new Map<string, string>();

      const ensureNomenclature = async (resourceId: string): Promise<string> => {
        const cached = nomencByResource.get(resourceId);
        if (cached) return cached;
        const r = resById.get(resourceId)!;
        // Copie du rattachement analytique au transfert : la nomenclature porte SON code analytique
        // et n'est plus jamais lue en direct depuis la bibliothèque d'étude (catalogues indépendants).
        const row = (
          await em.query(
            `INSERT INTO nomenclature_resource
               (tenant_id, chantier_id, marche_id, source_resource_id, code, label, unit, nature,
                unit_cost_etude, unit_cost_objectif, code_analytique_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING id`,
            [tenantId, chantier.id, marcheId, resourceId, r.code, r.label, r.unit, r.nature,
              r.unit_cost, r.code_analytique_id ?? null],
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
               (tenant_id, chantier_id, marche_id, parent_line_id, type, vendable, code, designation, unit,
                source_devis_line_id, source_ouvrage_id, quantite_etude, quantite_objectif,
                debourse_unitaire_etude, debourse_unitaire_objectif, sort_order)
             VALUES ($1,$2,$3,$4,'ouvrage',$5,$6,$7,$8,$9,$10,$11,$11,0,0,$12) RETURNING id`,
            [tenantId, chantier.id, marcheId, parentLineId, vendable, meta.code, meta.designation, meta.unit,
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
          WHERE devis_version_id = $1 AND type = 'ouvrage' AND source_ouvrage_id IS NOT NULL
          ORDER BY sort_order ASC, created_at ASC`,
        [versionId],
      );
      let top = 0;
      for (const dl of devisLines) {
        await materialize(dl.source_ouvrage_id, null, dl.vendable, dl.id, dl.quantity ?? '0',
          { code: dl.code, designation: dl.designation, unit: dl.unit }, top++);
      }

      await this.recompute(em, tenantId, chantier.id, true, marcheId);
      return devisLines.length;
    });
  }

  /** Recomputes the objectif budget by nature for every top line (étude too when freeze). */
  private async recompute(
    em: EntityManager,
    tenantId: string,
    chantierId: string,
    freeze: boolean,
    marcheId?: string,
  ): Promise<void> {
    // When a marché is given, only its lines are (re)computed — so accepting a new marché on an
    // existing chantier never re-freezes or disturbs the other marchés' études d'exécution.
    const lines = await em.query(
      `SELECT id, parent_line_id, vendable, quantite_objectif FROM execution_line
        WHERE chantier_id = $1 AND ($2::uuid IS NULL OR marche_id = $2)`,
      [chantierId, marcheId ?? null],
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

  /** The contre-étude is per-marché (cahier §5.5): a marché's étude d'exécution freezes on its own. */
  private async assertMarcheEditable(em: EntityManager, marcheId: string): Promise<void> {
    const m = await em.query(`SELECT contre_etude_status FROM marche WHERE id = $1`, [marcheId]);
    if (m.length === 0) throw new NotFoundException(`Unknown marché "${marcheId}"`);
    if (m[0].contre_etude_status === 'validated') {
      throw new ConflictException('Contre-étude is validated (frozen).');
    }
  }

  /** Renegotiate a resource unit price (contre-étude) and recompute the marché's objectif budget. */
  renegotiateResource(chantierId: string, nomenclatureResourceId: string, unitCostObjectif: string | number) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const nomenc = await em.query(
        `SELECT marche_id FROM nomenclature_resource WHERE id = $1 AND chantier_id = $2`,
        [nomenclatureResourceId, chantierId],
      );
      if (nomenc.length === 0) throw new NotFoundException('Unknown nomenclature resource');
      const marcheId = nomenc[0].marche_id as string;
      await this.assertMarcheEditable(em, marcheId);
      await em.query(
        `UPDATE nomenclature_resource SET unit_cost_objectif = $1, updated_at = now() WHERE id = $2`,
        [String(unitCostObjectif), nomenclatureResourceId],
      );
      await this.recompute(em, tenantId, chantierId, false, marcheId);
      return this.getChantierInTx(em, chantierId);
    });
  }

  /** Adjust a component quantity (contre-étude) and recompute the marché's objectif budget. */
  setComponentQuantity(componentId: string, quantiteObjectif: string | number) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT el.chantier_id, el.marche_id FROM execution_component ec
           JOIN execution_line el ON el.id = ec.execution_line_id WHERE ec.id = $1`,
        [componentId],
      );
      if (rows.length === 0) throw new NotFoundException(`Unknown component "${componentId}"`);
      const { chantier_id: chantierId, marche_id: marcheId } = rows[0];
      await this.assertMarcheEditable(em, marcheId);
      await em.query(
        `UPDATE execution_component SET quantite_objectif = $1, updated_at = now() WHERE id = $2`,
        [String(quantiteObjectif), componentId],
      );
      await this.recompute(em, tenantId, chantierId, false, marcheId);
      return this.getChantierInTx(em, chantierId);
    });
  }

  /** Validate a marché's contre-étude: freeze its objectif as the control "budget initial". */
  validateContreEtude(marcheId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const m = await em.query(`SELECT chantier_id FROM marche WHERE id = $1`, [marcheId]);
      if (m.length === 0) throw new NotFoundException(`Unknown marché "${marcheId}"`);
      await em.query(
        `UPDATE marche SET contre_etude_status = 'validated', updated_at = now() WHERE id = $1`,
        [marcheId],
      );
      // Initialise the prévisionnel budget from the validated objectif (this marché's lines).
      await em.query(
        `UPDATE execution_line_budget b SET montant_previsionnel = b.montant_objectif
           FROM execution_line l
          WHERE l.id = b.execution_line_id AND l.marche_id = $1`,
        [marcheId],
      );
      return this.getChantierInTx(em, m[0].chantier_id);
    });
  }

  /** Adjusts the prévisionnel budget of a line/nature (after the marché's contre-étude is validated). */
  setPrevisionnel(lineId: string, nature: string, montant: string | number) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT l.chantier_id, m.contre_etude_status
           FROM execution_line l JOIN marche m ON m.id = l.marche_id
          WHERE l.id = $1`,
        [lineId],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Unknown execution line "${lineId}"`);
      }
      if (rows[0].contre_etude_status !== 'validated') {
        throw new ConflictException('Validate the contre-étude before adjusting the prévisionnel.');
      }
      const upd = returningRows<{ id: string }>(
        await em.query(
          `UPDATE execution_line_budget SET montant_previsionnel = $1
          WHERE execution_line_id = $2 AND nature = $3 RETURNING id`,
          [String(montant), lineId, nature],
        ),
      );
      if (upd.length === 0) {
        throw new NotFoundException(`No budget line for nature "${nature}"`);
      }
      return this.getChantierInTx(em, rows[0].chantier_id);
    });
  }

  /** Creates a standalone (empty) chantier — an aggregation unit; marchés are added by acceptance. */
  createChantier(input: { code: string; name: string }) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const existing = await em.query(`SELECT id FROM chantier WHERE code = $1`, [input.code]);
      if (existing.length > 0) {
        throw new ConflictException(`Chantier code "${input.code}" already exists`);
      }
      return (
        await em.query(
          `INSERT INTO chantier (tenant_id, code, name, budget_vente_ht, status)
           VALUES ($1, $2, $3, 0, 'open') RETURNING *`,
          [tenantId, input.code, input.name],
        )
      )[0];
    });
  }

  getChantier(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) => this.getChantierInTx(em, chantierId));
  }

  /** Lists the marchés aggregated by a chantier (Chantier 1→N Marché). */
  listMarches(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.getChantierInTx(em, chantierId); // 404 if unknown
      return em.query(
        `SELECT id, code, name, total_ht, contre_etude_status, status, affaire_id
           FROM marche WHERE chantier_id = $1 ORDER BY created_at ASC`,
        [chantierId],
      );
    });
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
              SUM(b.montant_objectif)::numeric(16,2) AS objectif,
              SUM(b.montant_previsionnel)::numeric(16,2) AS previsionnel
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
