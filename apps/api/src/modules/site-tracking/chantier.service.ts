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
  NatureBreakdown,
  computeNatureBreakdownMap,
  zeroBreakdown,
} from '../estimating/ouvrage-calc';
import { VenteService } from '../estimating/vente.service';
import { BudgetNature } from './budget-nature';

interface DevisOuvrageLine {
  id: string;
  code: string | null;
  designation: string;
  unit: string | null;
  quantity: string | null;
  vendable: boolean;
  source_ouvrage_id: string;
}

@Injectable()
export class ChantierService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly vente: VenteService,
  ) {}

  /**
   * Transfers a won affaire (latest version) into a chantier with an étude d'exécution:
   * one execution line per devis ouvrage line, with a per-nature budget (étude = objectif).
   * Vendable lines carry their 4 resource natures; non-vendable titres go to site_overhead.
   */
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
      const current = await em.query(`SELECT status FROM affaire WHERE id = $1 FOR UPDATE`, [
        affaireId,
      ]);
      if (!isTransferable(current[0].status)) {
        throw new ConflictException('Only a won affaire can be transferred.');
      }
      const existing = await em.query(
        `SELECT id FROM chantier WHERE affaire_version_id = $1`,
        [versionId],
      );
      if (existing.length > 0) {
        throw new ConflictException('This affaire version already has a chantier.');
      }

      const breakdowns = await this.loadOuvrageBreakdowns(em);
      const lines: DevisOuvrageLine[] = await em.query(
        `SELECT id, code, designation, unit, quantity, vendable, source_ouvrage_id
           FROM devis_line
          WHERE affaire_version_id = $1 AND type = 'ouvrage' AND source_ouvrage_id IS NOT NULL
          ORDER BY sort_order ASC, created_at ASC`,
        [versionId],
      );

      const marche = await em.query(
        `SELECT id FROM marche WHERE affaire_version_id = $1`,
        [versionId],
      );

      const chantier = (
        await em.query(
          `INSERT INTO chantier
             (tenant_id, code, name, affaire_id, affaire_version_id, marche_id, budget_vente_ht)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            tenantId,
            `${affaire[0].code}-CH`,
            affaire[0].name,
            affaireId,
            versionId,
            marche.length > 0 ? marche[0].id : null,
            venteTotal,
          ],
        )
      )[0];

      let sortOrder = 0;
      for (const line of lines) {
        const unit = breakdowns.get(line.source_ouvrage_id) ?? zeroBreakdown();
        const qty = new Decimal(line.quantity ?? 0);
        const totalUnit = NATURES.reduce((acc, n) => acc.plus(unit[n]), new Decimal(0));

        const natureAmounts: Record<BudgetNature, Decimal> = {
          labor: new Decimal(0),
          material: new Decimal(0),
          equipment: new Decimal(0),
          subcontract: new Decimal(0),
          site_overhead: new Decimal(0),
        };
        if (line.vendable) {
          for (const n of NATURES) {
            natureAmounts[n] = unit[n].times(qty);
          }
        } else {
          natureAmounts.site_overhead = totalUnit.times(qty);
        }

        const execLine = (
          await em.query(
            `INSERT INTO execution_line
               (tenant_id, chantier_id, type, code, designation, unit, source_devis_line_id,
                source_ouvrage_id, quantite_etude, quantite_objectif,
                debourse_unitaire_etude, debourse_unitaire_objectif, sort_order)
             VALUES ($1,$2,'ouvrage',$3,$4,$5,$6,$7,$8,$8,$9,$9,$10) RETURNING id`,
            [
              tenantId,
              chantier.id,
              line.code,
              line.designation,
              line.unit,
              line.id,
              line.source_ouvrage_id,
              qty.toString(),
              totalUnit.toDecimalPlaces(4).toString(),
              sortOrder++,
            ],
          )
        )[0];

        for (const nature of Object.keys(natureAmounts) as BudgetNature[]) {
          const montant = natureAmounts[nature].toDecimalPlaces(2).toString();
          await em.query(
            `INSERT INTO execution_line_budget
               (tenant_id, execution_line_id, nature, montant_etude, montant_objectif)
             VALUES ($1, $2, $3, $4, $4)`,
            [tenantId, execLine.id, nature, montant],
          );
        }
      }

      return { chantier, lineCount: lines.length };
    });
  }

  getChantier(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const chantier = await em.query(`SELECT * FROM chantier WHERE id = $1`, [chantierId]);
      if (chantier.length === 0) {
        throw new NotFoundException(`Unknown chantier "${chantierId}"`);
      }
      const lines = await em.query(
        `SELECT * FROM execution_line WHERE chantier_id = $1 ORDER BY sort_order ASC`,
        [chantierId],
      );
      const budgetByNature = await em.query(
        `SELECT b.nature,
                SUM(b.montant_etude)::numeric(16,2) AS etude,
                SUM(b.montant_objectif)::numeric(16,2) AS objectif
           FROM execution_line_budget b
           JOIN execution_line l ON l.id = b.execution_line_id
          WHERE l.chantier_id = $1
          GROUP BY b.nature
          ORDER BY b.nature`,
        [chantierId],
      );
      return { chantier: chantier[0], lines, budgetByNature };
    });
  }

  listChantiers() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM chantier WHERE deleted_at IS NULL ORDER BY created_at DESC`),
    );
  }

  /** Loads every ouvrage's per-nature unit déboursé (reuses the Phase 1 pure engine). */
  private async loadOuvrageBreakdowns(
    em: EntityManager,
  ): Promise<Map<string, NatureBreakdown>> {
    const ouvrages = await em.query(`SELECT id FROM ouvrage`);
    const components = await em.query(
      `SELECT oc.parent_ouvrage_id, oc.kind, oc.quantity, oc.rate,
              oc.child_ouvrage_id, r.unit_cost, r.nature
         FROM ouvrage_component oc
         LEFT JOIN resource r ON r.id = oc.child_resource_id`,
    );
    const map = new Map<string, CalcOuvrage>();
    for (const o of ouvrages) {
      map.set(o.id, { id: o.id, components: [] });
    }
    for (const c of components) {
      const parent = map.get(c.parent_ouvrage_id);
      if (!parent) {
        continue;
      }
      const component: CalcComponent = { kind: c.kind };
      if (c.kind === 'resource') {
        component.quantity = c.quantity ?? 0;
        component.unitCost = c.unit_cost ?? 0;
        component.nature = c.nature ?? 'material';
      } else if (c.kind === 'sub_ouvrage') {
        component.quantity = c.quantity ?? 0;
        component.childOuvrageId = c.child_ouvrage_id;
      } else {
        component.rate = c.rate ?? 0;
      }
      parent.components.push(component);
    }
    return computeNatureBreakdownMap(map);
  }
}
