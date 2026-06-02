import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { EstimatingModule } from '../estimating/estimating.module';
import { AcceptanceService } from './acceptance.service';
import { AcceptanceController } from './acceptance.controller';

/** Invoicing (Facturation) — 2.1 acceptation (won affaire -> marché). */
@Module({
  imports: [TenancyModule, EstimatingModule],
  providers: [AcceptanceService],
  controllers: [AcceptanceController],
  exports: [AcceptanceService],
})
export class InvoicingModule {}
