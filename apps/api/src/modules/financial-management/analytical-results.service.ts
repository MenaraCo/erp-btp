import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { CalcComponent, CalcOuvrage } from '../estimating/ouvrage-calc';
import { computeBucketBreakdownMap } from '../estimating/bucket-breakdown';
import { AnalyticalPlanService } from '../analytical/analytical-plan.service';
import {
  aggregateAnalytical,
  MeasureRow,
  Metrics,
} from './analytical-aggregate';

const UNALLOC_PREFIX = '__unalloc__:';
const METRICS = ['budgetObjectif', 'engage', 'realise'] as const;

interface CompRow {
  execution_line_id: string;
  kind: string;
  child_line_id: string | null;
  quantite_objectif: string | null;
  rate: string | null;
  nature: string | null;
  unit_cost_objectif: string | null;
  famille_id: string | null;
}
interface LineRow {
  id: string;
  parent_line_id: string | null;
  vendable: boolean;
  quantite_objectif: string | null;
}

/**
 * Tableau de bord analytique d'un chantier (cahier des charges §5.8): budget / engagé / réalisé
 * agrégés le long de l'axe analytique nature → lot → famille, via le helper pur aggregateAnalytical.
 *
 * Hybrid handling of amounts outside the 4 analytical natures (user decision):
 *  - unimputed resources within the 4 natures → "Non réparti" bucket of their nature;
 *  - frais de chantier (site_overhead) → a dedicated "Frais de chantier" branch,
 * so the grand total always reconciles with the structural per-nature view.
 *
 * Budget shown here = budget OBJECTIF (the engine's "budget initial"). Prévisionnel stays in the
 * per-nature /results view and the formula engine (B.2).
 */
@Injectable()
export class AnalyticalResultsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly plan: AnalyticalPlanService,
  ) {}

  async chantierAnalyticalResults(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    await this.plan.ensurePlan(tenantId);
    const tree = await this.plan.getTree(tenantId);

    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);

      const rows: MeasureRow[] = [];
      const siteOverhead: Record<string, Decimal> = {
        budgetObjectif: new Decimal(0),
        engage: new Decimal(0),
        realise: new Decimal(0),
      };

      await this.collectBudget(em, chantierId, rows, siteOverhead);
      await this.collectEngage(em, chantierId, rows, siteOverhead);
      await this.collectRealise(em, chantierId, rows, siteOverhead);

      const aggregate = aggregateAnalytical(tree, rows, [...METRICS]);

      const total: Record<string, string> = {};
      for (const m of METRICS) {
        total[m] = new Decimal(aggregate.total[m] ?? 0).plus(siteOverhead[m]).toString();
      }

      return {
        chantierId,
        natures: aggregate.natures,
        siteOverhead: {
          label: 'Frais de chantier',
          metrics: Object.fromEntries(METRICS.map((m) => [m, siteOverhead[m].toString()])),
        },
        total,
      };
    });
  }

  /** Budget objectif by famille (vendable lines) + frais de chantier (non-vendable lines). */
  private async collectBudget(
    em: EntityManager,
    chantierId: string,
    rows: MeasureRow[],
    siteOverhead: Record<string, Decimal>,
  ): Promise<void> {
    const lines: LineRow[] = await em.query(
      `SELECT id, parent_line_id, vendable, quantite_objectif
         FROM execution_line WHERE chantier_id = $1`,
      [chantierId],
    );
    const comps: CompRow[] = await em.query(
      `SELECT ec.execution_line_id, ec.kind, ec.child_line_id, ec.quantite_objectif, ec.rate,
              n.nature, n.unit_cost_objectif, r.famille_analytique_id AS famille_id
         FROM execution_component ec
         JOIN execution_line el ON el.id = ec.execution_line_id
         LEFT JOIN nomenclature_resource n ON n.id = ec.nomenclature_resource_id
         LEFT JOIN resource r ON r.id = n.source_resource_id
        WHERE el.chantier_id = $1`,
      [chantierId],
    );

    const map = new Map<string, CalcOuvrage>();
    for (const l of lines) map.set(l.id, { id: l.id, components: [] });
    for (const c of comps) {
      const parent = map.get(c.execution_line_id);
      if (!parent) continue;
      const comp: CalcComponent = { kind: c.kind === 'sub_line' ? 'sub_ouvrage' : c.kind === 'resource' ? 'resource' : 'percentage' };
      if (c.kind === 'resource') {
        comp.quantity = c.quantite_objectif ?? 0;
        comp.unitCost = c.unit_cost_objectif ?? 0;
        // bucket = famille if classified, else a per-nature "unallocated" key
        comp.bucket = c.famille_id ?? `${UNALLOC_PREFIX}${c.nature ?? 'material'}`;
      } else if (c.kind === 'sub_line') {
        comp.quantity = c.quantite_objectif ?? 0;
        comp.childOuvrageId = c.child_line_id ?? undefined;
      } else {
        comp.rate = c.rate ?? 0;
      }
      parent.components.push(comp);
    }

    const breakdown = computeBucketBreakdownMap(map);
    for (const l of lines) {
      if (l.parent_line_id) continue; // budget only on top lines
      const unit = breakdown.get(l.id) ?? {};
      const qty = new Decimal(l.quantite_objectif ?? 0);
      if (!l.vendable) {
        // non-vendable titre → frais de chantier
        for (const value of Object.values(unit)) {
          siteOverhead.budgetObjectif = siteOverhead.budgetObjectif.plus(value.times(qty));
        }
        continue;
      }
      for (const [bucket, value] of Object.entries(unit)) {
        const montant = value.times(qty);
        rows.push(this.bucketToRow(bucket, { budgetObjectif: montant.toString() }));
      }
    }
  }

  private async collectEngage(
    em: EntityManager,
    chantierId: string,
    rows: MeasureRow[],
    siteOverhead: Record<string, Decimal>,
  ): Promise<void> {
    const engage = await em.query(
      `SELECT l.famille_analytique_id AS famille_id, l.nature,
              SUM(l.amount_ht)::numeric(16,2) AS montant
         FROM purchase_order_line l JOIN purchase_order o ON o.id = l.order_id
        WHERE o.chantier_id = $1 AND o.status = 'validated'
        GROUP BY l.famille_analytique_id, l.nature`,
      [chantierId],
    );
    for (const r of engage) {
      this.dispatch(rows, siteOverhead, r.famille_id, r.nature, 'engage', r.montant);
    }
  }

  private async collectRealise(
    em: EntityManager,
    chantierId: string,
    rows: MeasureRow[],
    siteOverhead: Record<string, Decimal>,
  ): Promise<void> {
    const invoices = await em.query(
      `SELECT famille_analytique_id AS famille_id, nature,
              SUM(amount_ht)::numeric(16,2) AS montant
         FROM supplier_invoice WHERE chantier_id = $1
        GROUP BY famille_analytique_id, nature`,
      [chantierId],
    );
    for (const r of invoices) {
      this.dispatch(rows, siteOverhead, r.famille_id, r.nature, 'realise', r.montant);
    }
    // Labor réalisé from timesheets (no famille → "Non réparti" under labor).
    const labor = (
      await em.query(
        `SELECT COALESCE(SUM(cost), 0)::numeric(16,2) AS total FROM timesheet WHERE chantier_id = $1`,
        [chantierId],
      )
    )[0].total;
    if (new Decimal(labor).gt(0)) {
      rows.push({ familleId: null, nature: 'labor', metrics: { realise: labor } });
    }
  }

  /** Routes a measure to the famille tree, the per-nature unallocated bucket, or frais de chantier. */
  private dispatch(
    rows: MeasureRow[],
    siteOverhead: Record<string, Decimal>,
    familleId: string | null,
    nature: string,
    metric: string,
    montant: string,
  ): void {
    if (!familleId && nature === 'site_overhead') {
      siteOverhead[metric] = siteOverhead[metric].plus(new Decimal(montant));
      return;
    }
    rows.push({
      familleId: familleId ?? null,
      nature: (nature === 'site_overhead' ? 'material' : nature) as MeasureRow['nature'],
      metrics: { [metric]: montant } as Metrics,
    });
  }

  private bucketToRow(bucket: string, metrics: Metrics): MeasureRow {
    if (bucket.startsWith(UNALLOC_PREFIX)) {
      return {
        familleId: null,
        nature: bucket.slice(UNALLOC_PREFIX.length) as MeasureRow['nature'],
        metrics,
      };
    }
    // Known famille: aggregateAnalytical places it by the plan; nature here is a placeholder.
    return { familleId: bucket, nature: 'material', metrics };
  }

  private async assertChantier(em: EntityManager, chantierId: string): Promise<void> {
    const c = await em.query(`SELECT id FROM chantier WHERE id = $1`, [chantierId]);
    if (c.length === 0) throw new NotFoundException(`Unknown chantier "${chantierId}"`);
  }
}
