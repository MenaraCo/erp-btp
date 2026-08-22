import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { engageMainOeuvreParCode } from '../site-tracking/labor-commitment';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { AnalyticalPlanService } from '../analytical/analytical-plan.service';
import { aggregateAnalytical, MeasureRow, Metrics } from './analytical-aggregate';
import { budgetEtude, UNALLOC_PREFIX } from './budget-etude';

const METRICS = ['budgetObjectif', 'engage', 'realise'] as const;

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

  /**
   * Budget objectif par code analytique = budget d'ÉTUDE d'exécution (calculé) + MOUVEMENTS de
   * budget saisis (dotations, reprises, ripages). Ignorer les mouvements ferait mentir l'écart :
   * on comparerait la dépense à une cible que le conducteur a lui-même déplacée.
   */
  private async collectBudget(
    em: EntityManager,
    chantierId: string,
    rows: MeasureRow[],
    siteOverhead: Record<string, Decimal>,
  ): Promise<void> {
    const etude = await budgetEtude(em, chantierId, 'code');
    for (const [bucket, montant] of etude.parBucket) {
      rows.push(this.bucketToRow(bucket, { budgetObjectif: montant.toString() }));
    }
    // Frais de chantier repris du devis : tant qu'ils ne sont pas ventilés, ils restent dans leur
    // branche. VENTILÉS, ils rejoignent leur code analytique — c'est tout l'intérêt de les avoir
    // ventilés, et sans cela le conducteur ne voit jamais l'effet de son classement.
    const categories: Array<{ id: string; categorie: string }> = await em.query(
      `SELECT id, COALESCE(categorie, 'charge') AS categorie FROM analytical_code`,
    );
    const parCategorie = new Map(categories.map((c) => [c.id, c.categorie]));
    for (const [bucket, montant] of etude.fraisParBucket) {
      const categorie = bucket.startsWith(UNALLOC_PREFIX) ? null : parCategorie.get(bucket) ?? 'charge';
      // Un poste de PRODUITS n'est pas une charge : il n'a rien à faire dans ce tableau de coûts.
      if (categorie === 'produit') continue;
      if (categorie === 'charge') {
        rows.push(this.bucketToRow(bucket, { budgetObjectif: montant.toString() }));
      } else {
        siteOverhead.budgetObjectif = siteOverhead.budgetObjectif.plus(montant);
      }
    }

    // Hors recettes (ce sont des produits) ; les frais généraux saisis rejoignent la branche
    // « frais de chantier », qui est déjà celle des lignes non vendables reprises du devis.
    const mouvements = await em.query(
      `SELECT b.code_analytique_id AS code_id,
              CASE WHEN b.nature = 'frais_generaux' THEN 'site_overhead' ELSE b.nature END AS nature,
              SUM(b.montant)::numeric(16,2) AS montant
         FROM chantier_budget_movement b
         LEFT JOIN analytical_code c ON c.id = b.code_analytique_id
        WHERE b.chantier_id = $1 AND b.statut = 'traite'
          AND COALESCE(c.categorie, 'charge') <> 'produit'
        GROUP BY 1, 2`,
      [chantierId],
    );
    for (const m of mouvements) {
      if (new Decimal(m.montant ?? 0).isZero()) continue;
      this.dispatch(rows, siteOverhead, m.code_id, m.nature, 'budgetObjectif', m.montant);
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
    // Main d'œuvre engagée : journées planifiées non encore pointées, au code de la fiche salarié.
    for (const r of await engageMainOeuvreParCode(em, chantierId)) {
      if (new Decimal(r.montant ?? 0).isZero()) continue;
      this.dispatch(rows, siteOverhead, r.code_id, 'labor', 'engage', r.montant);
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
    // Éléments variables de paye (paniers, déplacements, primes, heures supplémentaires) : ils
    // sont payés, donc ils sont réalisés. Les laisser dehors afficherait une marge flatteuse —
    // sur une année, ces lignes pèsent des milliers d'euros par salarié.
    const paye = await em.query(
      `SELECT l.code_analytique_id AS code_id, r.nature,
              SUM(l.montant)::numeric(16,2) AS montant
         FROM payroll_line l
         JOIN payroll_rubrique r ON r.id = l.rubrique_id
        WHERE l.chantier_id = $1
        GROUP BY l.code_analytique_id, r.nature`,
      [chantierId],
    );
    for (const r of paye) {
      if (new Decimal(r.montant ?? 0).isZero()) continue;
      this.dispatch(rows, siteOverhead, r.code_id, r.nature ?? 'labor', 'realise', r.montant);
    }
    // Stock : ce qui est sorti du magasin pour ce chantier, au prix moyen pondéré. Sans cette
    // ligne, le magasin absorberait des coûts que le chantier a pourtant bien consommés.
    const stock = await em.query(
      `SELECT code_analytique_id AS code_id, SUM(montant)::numeric(16,2) AS montant
         FROM stock_mouvement
        WHERE chantier_id = $1 AND type = 'sortie'
        GROUP BY code_analytique_id`,
      [chantierId],
    );
    for (const r of stock) {
      if (new Decimal(r.montant ?? 0).isZero()) continue;
      this.dispatch(rows, siteOverhead, r.code_id, 'material', 'realise', r.montant);
    }
    // Matériel : ce que l'engin a réellement servi sur le chantier, à son coût d'utilisation.
    const materiel = await em.query(
      `SELECT code_analytique_id AS code_id, SUM(cout)::numeric(16,2) AS montant
         FROM equipment_usage WHERE chantier_id = $1 GROUP BY code_analytique_id`,
      [chantierId],
    );
    for (const r of materiel) {
      if (new Decimal(r.montant ?? 0).isZero()) continue;
      this.dispatch(rows, siteOverhead, r.code_id, 'equipment', 'realise', r.montant);
    }
  }

  /**
   * Ressources de nomenclature sans code analytique : la liste de travail du conducteur.
   * Une ressource arrivée sans code au transfert atterrit ici, pas dans une nature au hasard.
   */
  private async listAVentiler(em: EntityManager, chantierId: string) {
    // Seules les ressources qui alimentent l'arbre des codes sont à ventiler : celles des lignes
    // NON vendables (frais de chantier) ont déjà leur branche dédiée, elles n'ont rien à y faire.
    return em.query(
      `SELECT DISTINCT n.id, n.code, n.label, n.unit, n.nature, n.unit_cost_objectif,
              m.code AS marche_code
         FROM nomenclature_resource n
         JOIN marche m ON m.id = n.marche_id
         JOIN execution_component ec ON ec.nomenclature_resource_id = n.id
         JOIN execution_line el ON el.id = ec.execution_line_id
         JOIN execution_line top ON top.id = COALESCE(el.parent_line_id, el.id)
        WHERE n.chantier_id = $1 AND n.code_analytique_id IS NULL AND top.vendable = true
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
