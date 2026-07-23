import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { AnalyticalModule } from '../analytical/analytical.module';
import { SiteTrackingModule } from '../site-tracking/site-tracking.module';
import { FinancialConfigService } from './financial-config.service';
import { AdvancementService } from './advancement.service';
import { AnalyticalResultsService } from './analytical-results.service';
import { FinancialForecastService } from './financial-forecast.service';
import { PortfolioService } from './portfolio.service';
import { FinancialController } from './financial.controller';

/**
 * Gestion financière (cahier des charges §5.8) — the differentiating predictive cost-control
 * bounded context. B.1: premium packaging, versioned formula parameters, advancement input.
 * B.0e: analytical dashboard (budget/engagé/réalisé aggregated along the analytical axis).
 */
@Module({
  imports: [TenancyModule, AnalyticalModule, SiteTrackingModule],
  providers: [
    PortfolioService,
    FinancialConfigService,
    AdvancementService,
    AnalyticalResultsService,
    FinancialForecastService,
  ],
  controllers: [FinancialController],
  exports: [FinancialConfigService, AdvancementService],
})
export class FinancialManagementModule {}
