import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { FinancialConfigService } from './financial-config.service';
import { AdvancementService } from './advancement.service';
import { FinancialController } from './financial.controller';

/**
 * Gestion financière (cahier des charges §5.8) — the differentiating predictive cost-control
 * bounded context. B.1: premium packaging, versioned formula parameters, advancement input.
 */
@Module({
  imports: [TenancyModule],
  providers: [FinancialConfigService, AdvancementService],
  controllers: [FinancialController],
  exports: [FinancialConfigService, AdvancementService],
})
export class FinancialManagementModule {}
