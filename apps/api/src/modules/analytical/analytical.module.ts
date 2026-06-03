import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { AnalyticalPlanService } from './analytical-plan.service';
import { AnalyticalController } from './analytical.controller';

/**
 * Plan analytique (cahier des charges §5.8) — the configurable analytical axis
 * nature → lot → famille → ressource shared by estimating and Gestion financière.
 */
@Module({
  imports: [TenancyModule],
  providers: [AnalyticalPlanService],
  controllers: [AnalyticalController],
  exports: [AnalyticalPlanService],
})
export class AnalyticalModule {}
