import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { EstimatingModule } from '../estimating/estimating.module';
import { AcceptanceService } from './acceptance.service';
import { AcceptanceController } from './acceptance.controller';
import { SituationsService } from './situations.service';
import { SituationsController } from './situations.controller';
import { AvenantService } from './avenant.service';
import { AvenantController } from './avenant.controller';

/** Invoicing (Facturation) — 2.1 acceptation, 2.2 situations à l'avancement, 2.3 avenants. */
@Module({
  imports: [TenancyModule, EstimatingModule],
  providers: [AcceptanceService, SituationsService, AvenantService],
  controllers: [AcceptanceController, SituationsController, AvenantController],
  exports: [AcceptanceService, SituationsService, AvenantService],
})
export class InvoicingModule {}
