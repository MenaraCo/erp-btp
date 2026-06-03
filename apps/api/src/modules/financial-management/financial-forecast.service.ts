import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
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
    const adv = await this.advancement.current(chantierId);

    const previsionnel = await runInTenant(this.dataSource, tenantId, async (em) => {
      const row = await em.query(
        `SELECT COALESCE(SUM(b.montant_previsionnel), 0)::numeric(16,2) AS total
           FROM execution_line_budget b
           JOIN execution_line l ON l.id = b.execution_line_id
          WHERE l.chantier_id = $1 AND l.parent_line_id IS NULL`,
        [chantierId],
      );
      return row[0].total as string;
    });

    const avancement = adv.global?.pct ?? '0';

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
