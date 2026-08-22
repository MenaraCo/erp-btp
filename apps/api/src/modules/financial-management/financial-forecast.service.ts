import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { AnalyticsService } from '../site-tracking/analytics.service';
import { FinancialConfigService } from './financial-config.service';
import { AdvancementService } from './advancement.service';
import { computeIndicators, FormulaInputs } from './financial-formulas';

/**
 * Vue Conducteur / prévisionnel d'un chantier (cahier des charges §5.8, B.3). Assembles, in real
 * time, the 4 axes (vente / budget / engagé / réalisé) + the advancement and the versioned formula
 * parameters, then runs the pure engine. No calculation is done in the screen.
 */
@Injectable()
export class FinancialForecastService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly analytics: AnalyticsService,
    private readonly config: FinancialConfigService,
    private readonly advancement: AdvancementService,
  ) {}

  async chantierForecast(chantierId: string) {
    const tenantId = this.context.requireTenantId();

    const results = await this.analytics.chantierResults(chantierId); // 404 if unknown chantier
    const formulaSet = await this.config.getActiveFormulaSet(tenantId);
    // Avancement global effectif : moyenne pondérée des avancements par ouvrage, sinon global saisi.
    const effectivePct = await this.advancement.effectiveGlobalPct(chantierId);

    const previsionnel = await runInTenant(this.dataSource, tenantId, async (em) => {
      const row = await em.query(
        `SELECT COALESCE(SUM(b.montant_previsionnel), 0)::numeric(16,2) AS total
           FROM execution_line_budget b
           JOIN execution_line l ON l.id = b.execution_line_id
          WHERE l.chantier_id = $1 AND l.parent_line_id IS NULL`,
        [chantierId],
      );
      // Le prévisionnel ne connaît que les ouvrages ; les frais généraux et les dotations vivent
      // en MOUVEMENTS de budget. Les oublier ferait un coût final estimé plus bas que le budget
      // lui-même — l'écran annoncerait une marge que le chantier n'a pas.
      const mvt = await em.query(
        `SELECT COALESCE(SUM(montant), 0)::numeric(16,2) AS total
           FROM chantier_budget_movement
          WHERE chantier_id = $1 AND statut = 'traite' AND nature <> 'produit'`,
        [chantierId],
      );
      return new Decimal(row[0].total).plus(mvt[0].total).toFixed(2);
    });

    const avancement = effectivePct;

    const inputs: FormulaInputs = {
      vente: results.budgetVenteHt ?? '0',
      budget: results.totals.budgetObjectif,
      previsionnel,
      engage: results.totals.engage,
      realise: results.totals.realise,
      avancement,
      eacMethod: formulaSet.eac_method,
      ecartAlertPct: formulaSet.ecart_alert_pct,
      margeCiblePct: formulaSet.marge_cible_pct,
    };

    return {
      chantierId,
      formulaSetVersion: formulaSet.version,
      avancement,
      inputs,
      indicators: computeIndicators(inputs),
    };
  }
}
