import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { EstimatingModule } from '../estimating/estimating.module';
import { AcceptanceService } from './acceptance.service';
import { AcceptanceController } from './acceptance.controller';
import { SituationsService } from './situations.service';
import { SituationsController } from './situations.controller';
import { AvenantService } from './avenant.service';
import { AvenantController } from './avenant.controller';
import { DgdService } from './dgd.service';
import { DgdController } from './dgd.controller';

/** Invoicing (Facturation) — 2.1 acceptation, 2.2 situations, 2.3 avenants, 2.4 DGD. */
@Module({
  imports: [TenancyModule, EstimatingModule],
  providers: [AcceptanceService, SituationsService, AvenantService, DgdService],
  controllers: [
    AcceptanceController,
    SituationsController,
    AvenantController,
    DgdController,
  ],
  exports: [AcceptanceService, SituationsService, AvenantService, DgdService],
})
export class InvoicingModule {}
