import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { engageMainOeuvre } from './labor-commitment';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { BUDGET_NATURES, BudgetNature } from './budget-nature';
import { natureResult, NatureResult } from './analytics-calc';

/** Charge accounts per nature for the accounting export amorce (PCG-like, to refine). */
const CHARGE_ACCOUNT: Record<BudgetNature, string> = {
  material: '601',
  equipment: '613',
  subcontract: '604',
  labor: '621',
  site_overhead: '606',
};
const SUPPLIER_ACCOUNT = '401';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Per-nature synthesis: budget (objectif/prévisionnel) vs engagé vs réalisé, with écart. */
  chantierResults(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const chantier = await em.query(
        `SELECT id, budget_vente_ht FROM chantier WHERE id = $1`,
        [chantierId],
      );
      if (chantier.length === 0) {
        throw new NotFoundException(`Unknown chantier "${chantierId}"`);
      }

      const budget = await em.query(
        `SELECT b.nature,
                SUM(b.montant_objectif)::numeric(16,2) AS objectif,
                SUM(b.montant_previsionnel)::numeric(16,2) AS previsionnel
           FROM execution_line_budget b
           JOIN execution_line l ON l.id = b.execution_line_id
          WHERE l.chantier_id = $1 AND l.parent_line_id IS NULL
          GROUP BY b.nature`,
        [chantierId],
      );
      const engage = await em.query(
        `SELECT l.nature, SUM(l.amount_ht)::numeric(16,2) AS montant
           FROM purchase_order_line l JOIN purchase_order o ON o.id = l.order_id
          WHERE o.chantier_id = $1 AND o.status = 'validated'
          GROUP BY l.nature`,
        [chantierId],
      );
      const supplier = await em.query(
        `SELECT nature, SUM(amount_ht)::numeric(16,2) AS montant
           FROM supplier_invoice WHERE chantier_id = $1 GROUP BY nature`,
        [chantierId],
      );
      // Main d'œuvre engagée : les journées planifiées et pas encore pointées (§5.8).
      const laborEngage = await engageMainOeuvre(em, chantierId);
      const laborTimesheets = (
        await em.query(
          `SELECT COALESCE(SUM(cost), 0)::numeric(16,2) AS total FROM timesheet WHERE chantier_id = $1`,
          [chantierId],
        )
      )[0].total;
      // Éléments variables de paye rattachés au chantier : payés, donc réalisés, par nature.
      const payeParNature = await em.query(
        `SELECT r.nature, SUM(l.montant)::numeric(16,2) AS montant
           FROM payroll_line l
           JOIN payroll_rubrique r ON r.id = l.rubrique_id
          WHERE l.chantier_id = $1 GROUP BY r.nature`,
        [chantierId],
      );
      const payeMap = mapBy(payeParNature, 'montant');
      // Matériel : le réalisé vient des relevés d'utilisation ; l'engagé, des journées affectées
      // qui n'ont pas encore de relevé — sans cette exclusion, une journée servie compterait deux
      // fois, une fois promise et une fois faite.
      const materielRealise = (await em.query(
        `SELECT COALESCE(SUM(cout), 0)::numeric(16,2) AS total
           FROM equipment_usage WHERE chantier_id = $1`,
        [chantierId],
      ))[0].total;
      // Amenée et repli réservés mais pas encore relevés : un transport promis est engagé.
      const transportEngage = (await em.query(
        `SELECT COALESCE(SUM(
                  CASE WHEN NOT EXISTS (
                    SELECT 1 FROM equipment_usage u
                     WHERE u.equipment_id = a.equipment_id AND u.chantier_id = a.chantier_id
                       AND u.type = 'amenee'
                  ) THEN a.cout_amenee ELSE 0 END
                  + CASE WHEN NOT EXISTS (
                    SELECT 1 FROM equipment_usage u
                     WHERE u.equipment_id = a.equipment_id AND u.chantier_id = a.chantier_id
                       AND u.type = 'repli'
                  ) THEN a.cout_repli ELSE 0 END
                ), 0)::numeric(16,2) AS total
           FROM equipment_assignment a WHERE a.chantier_id = $1`,
        [chantierId],
      ))[0].total;
      const materielEngage = (await em.query(
        `WITH jours AS (
           SELECT a.equipment_id, e.cout_unitaire, e.unite_cout,
                  generate_series(a.date_debut, a.date_fin, INTERVAL '1 day')::date AS jour
             FROM equipment_assignment a
             JOIN equipment e ON e.id = a.equipment_id
            WHERE a.chantier_id = $1
         )
         SELECT COALESCE(SUM(
                  -- Un engin facturé à l'heure est engagé sur une journée type de 7 heures :
                  -- l'affectation réserve des jours, pas des heures.
                  CASE WHEN j.unite_cout = 'heure' THEN j.cout_unitaire * 7 ELSE j.cout_unitaire END
                ), 0)::numeric(16,2) AS total
           FROM jours j
          WHERE EXTRACT(ISODOW FROM j.jour) < 6
            AND NOT EXISTS (
              SELECT 1 FROM equipment_usage u
               WHERE u.equipment_id = j.equipment_id AND u.chantier_id = $1
                 AND u.work_date = j.jour AND u.type = 'utilisation'
            )`,
        [chantierId],
      ))[0].total;

      const budgetObj = mapBy(budget, 'objectif');
      const budgetPrev = mapBy(budget, 'previsionnel');
      const engageMap = mapBy(engage, 'montant');
      const supplierMap = mapBy(supplier, 'montant');

      const results: NatureResult[] = BUDGET_NATURES.map((nature) => {
        let realise = new Decimal(supplierMap[nature] ?? 0).plus(payeMap[nature] ?? 0);
        let engageNature = new Decimal(engageMap[nature] ?? 0);
        if (nature === 'labor') {
          realise = realise.plus(new Decimal(laborTimesheets));
          engageNature = engageNature.plus(new Decimal(laborEngage));
        }
        if (nature === 'equipment') {
          realise = realise.plus(new Decimal(materielRealise));
          engageNature = engageNature
            .plus(new Decimal(materielEngage))
            .plus(new Decimal(transportEngage));
        }
        return natureResult({
          nature,
          budgetObjectif: budgetObj[nature] ?? 0,
          budgetPrevisionnel: budgetPrev[nature] ?? 0,
          engage: engageNature.toString(),
          realise: realise.toString(),
        });
      });

      const totals = results.reduce(
        (acc, r) => ({
          budgetObjectif: acc.budgetObjectif.plus(r.budgetObjectif),
          engage: acc.engage.plus(r.engage),
          realise: acc.realise.plus(r.realise),
          ecart: acc.ecart.plus(r.ecart),
        }),
        { budgetObjectif: new Decimal(0), engage: new Decimal(0), realise: new Decimal(0), ecart: new Decimal(0) },
      );

      return {
        chantierId,
        budgetVenteHt: chantier[0].budget_vente_ht,
        byNature: results,
        totals: {
          budgetObjectif: totals.budgetObjectif.toFixed(2),
          engage: totals.engage.toFixed(2),
          realise: totals.realise.toFixed(2),
          ecart: totals.ecart.toFixed(2),
        },
      };
    });
  }

  /** Accounting export amorce: supplier invoices → journal ACH entries (to refine for FEC). */
  accountingExport(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      const invoices = await em.query(
        `SELECT code, nature, amount_ht, invoice_date FROM supplier_invoice
          WHERE chantier_id = $1 ORDER BY invoice_date ASC`,
        [chantierId],
      );
      const entries = invoices.map(
        (i: { code: string; nature: BudgetNature; amount_ht: string; invoice_date: string }) => ({
          date: i.invoice_date,
          label: `Facture ${i.code}`,
          debit: { account: CHARGE_ACCOUNT[i.nature] ?? '60', amount: i.amount_ht },
          credit: { account: SUPPLIER_ACCOUNT, amount: i.amount_ht },
        }),
      );
      return { journal: 'ACH', note: 'amorce — export FEC complet à venir (add-on)', entries };
    });
  }

  private async assertChantier(em: EntityManager, chantierId: string): Promise<void> {
    const c = await em.query(`SELECT id FROM chantier WHERE id = $1`, [chantierId]);
    if (c.length === 0) {
      throw new NotFoundException(`Unknown chantier "${chantierId}"`);
    }
  }
}

function mapBy(rows: Array<Record<string, string>>, field: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    out[r.nature] = r[field];
  }
  return out;
}
