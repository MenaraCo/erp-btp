import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { CalcComponent, CalcOuvrage } from '../estimating/ouvrage-calc';
import { computeBucketBreakdownMap } from '../estimating/bucket-breakdown';
import { AnalyticalPlanService } from '../analytical/analytical-plan.service';
import { aggregateAnalytical, MeasureRow, Metrics } from './analytical-aggregate';

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
  code_id: string | null;
}
interface LineRow {
  id: string;
  parent_line_id: string | null;
  vendable: boolean;
  quantite_objectif: string | null;
}

/**
 * Tableau de bord analytique d'un chantier (cahier des charges §5.8): budget / engagé / réalisé
 * agrégés le long de l'axe analytique nature → lot → famille → code analytique (helper pur
 * aggregateAnalytical). L'imputation se fait au CODE ANALYTIQUE ; le budget lit le code analytique
 * propre à la nomenclature de chantier (copié au transfert) — aucune lecture live vers la
 * bibliothèque d'étude (catalogues indépendants, §5.5).
 *
 * Hors des 4 natures analytiques (décision propriétaire) : ressources non imputées → « Non
 * réparti » de leur nature ; frais de chantier (site_overhead) → branche dédiée. Le total se
 * réconcilie toujours.
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
        // Branche « 999 — À ventiler » + les ressources qui la remplissent, pour que le conducteur
        // puisse les classer sans quitter l'écran.
        aVentiler: {
          ...aggregate.aVentiler,
          resources: await this.listAVentiler(em, chantierId),
        },
        siteOverhead: {
          label: 'Frais de chantier',
          metrics: Object.fromEntries(METRICS.map((m) => [m, siteOverhead[m].toString()])),
        },
        total,
      };
    });
  }

  /** Budget objectif par code analytique (lignes vendables) + frais de chantier (non-vendables). */
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
    // Code analytique = celui de la nomenclature de chantier (copié au transfert), pas la biblio.
    const comps: CompRow[] = await em.query(
      `SELECT ec.execution_line_id, ec.kind, ec.child_line_id, ec.quantite_objectif, ec.rate,
              n.nature, n.unit_cost_objectif, n.code_analytique_id AS code_id
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
      const comp: CalcComponent = { kind: c.kind === 'sub_line' ? 'sub_ouvrage' : c.kind === 'resource' ? 'resource' : 'percentage' };
      if (c.kind === 'resource') {
        comp.quantity = c.quantite_objectif ?? 0;
        comp.unitCost = c.unit_cost_objectif ?? 0;
        comp.bucket = c.code_id ?? `${UNALLOC_PREFIX}${c.nature ?? 'material'}`;
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
        for (const value of Object.values(unit)) {
          siteOverhead.budgetObjectif = siteOverhead.budgetObjectif.plus(value.times(qty));
        }
        continue;
      }
      for (const [bucket, value] of Object.entries(unit)) {
        rows.push(this.bucketToRow(bucket, { budgetObjectif: value.times(qty).toString() }));
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
      `SELECT l.code_analytique_id AS code_id, l.nature, SUM(l.amount_ht)::numeric(16,2) AS montant
         FROM purchase_order_line l JOIN purchase_order o ON o.id = l.order_id
        WHERE o.chantier_id = $1 AND o.status = 'validated'
        GROUP BY l.code_analytique_id, l.nature`,
      [chantierId],
    );
    for (const r of engage) {
      this.dispatch(rows, siteOverhead, r.code_id, r.nature, 'engage', r.montant);
    }
  }

  private async collectRealise(
    em: EntityManager,
    chantierId: string,
    rows: MeasureRow[],
    siteOverhead: Record<string, Decimal>,
  ): Promise<void> {
    const invoices = await em.query(
      `SELECT code_analytique_id AS code_id, nature, SUM(amount_ht)::numeric(16,2) AS montant
         FROM supplier_invoice WHERE chantier_id = $1
        GROUP BY code_analytique_id, nature`,
      [chantierId],
    );
    for (const r of invoices) {
      this.dispatch(rows, siteOverhead, r.code_id, r.nature, 'realise', r.montant);
    }
    // Réalisé MO depuis les pointages (nature labor), imputé au code analytique s'il est renseigné.
    const labor = await em.query(
      `SELECT code_analytique_id AS code_id, SUM(cost)::numeric(16,2) AS montant
         FROM timesheet WHERE chantier_id = $1 GROUP BY code_analytique_id`,
      [chantierId],
    );
    for (const r of labor) {
      if (new Decimal(r.montant ?? 0).isZero()) continue;
      this.dispatch(rows, siteOverhead, r.code_id, 'labor', 'realise', r.montant);
    }
  }

  /**
   * Ressources de nomenclature sans code analytique : la liste de travail du conducteur.
   * Une ressource arrivée sans code au transfert atterrit ici, pas dans une nature au hasard.
   */
  private async listAVentiler(em: EntityManager, chantierId: string) {
    return em.query(
      `SELECT n.id, n.code, n.label, n.unit, n.nature, n.unit_cost_objectif, m.code AS marche_code
         FROM nomenclature_resource n
         JOIN marche m ON m.id = n.marche_id
        WHERE n.chantier_id = $1 AND n.code_analytique_id IS NULL
        ORDER BY n.label`,
      [chantierId],
    );
  }

  /** Routes a measure to the code-analytique tree, the « à ventiler » branch, or frais de chantier. */
  private dispatch(
    rows: MeasureRow[],
    siteOverhead: Record<string, Decimal>,
    codeId: string | null,
    nature: string,
    metric: string,
    montant: string,
  ): void {
    if (!codeId && nature === 'site_overhead') {
      siteOverhead[metric] = siteOverhead[metric].plus(new Decimal(montant));
      return;
    }
    rows.push({
      codeId: codeId ?? null,
      nature: (nature === 'site_overhead' ? 'material' : nature) as MeasureRow['nature'],
      metrics: { [metric]: montant } as Metrics,
    });
  }

  private bucketToRow(bucket: string, metrics: Metrics): MeasureRow {
    if (bucket.startsWith(UNALLOC_PREFIX)) {
      return { codeId: null, nature: bucket.slice(UNALLOC_PREFIX.length) as MeasureRow['nature'], metrics };
    }
    // Code analytique connu : aggregateAnalytical le place via le plan ; nature ici n'est qu'un repli.
    return { codeId: bucket, nature: 'material', metrics };
  }

  private async assertChantier(em: EntityManager, chantierId: string): Promise<void> {
    const c = await em.query(`SELECT id FROM chantier WHERE id = $1`, [chantierId]);
    if (c.length === 0) throw new NotFoundException(`Unknown chantier "${chantierId}"`);
  }
}
