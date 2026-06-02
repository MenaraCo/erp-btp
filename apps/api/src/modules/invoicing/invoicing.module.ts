import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { EstimatingModule } from '../estimating/estimating.module';
import { AcceptanceService } from './acceptance.service';
import { AcceptanceController } from './acceptance.controller';
import { SituationsService } from './situations.service';
import { SituationsController } from './situations.controller';

/** Invoicing (Facturation) — 2.1 acceptation (marché), 2.2 situations à l'avancement. */
@Module({
  imports: [TenancyModule, EstimatingModule],
  providers: [AcceptanceService, SituationsService],
  controllers: [AcceptanceController, SituationsController],
  exports: [AcceptanceService, SituationsService],
})
export class InvoicingModule {}
