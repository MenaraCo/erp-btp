import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { EstimatingModule } from '../estimating/estimating.module';
import { ChantierService } from './chantier.service';
import { ChantierController } from './chantier.controller';
import { TimesheetService } from './timesheet.service';
import { TimesheetController } from './timesheet.controller';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';

/**
 * Suivi de chantiers — 3.1 transfert → chantier, 3.2 contre-étude, 3.3 budget prévisionnel,
 * 3.4 pointages MO, 3.5 chaîne des achats.
 */
@Module({
  imports: [TenancyModule, EstimatingModule],
  providers: [ChantierService, TimesheetService, PurchasingService],
  controllers: [ChantierController, TimesheetController, PurchasingController],
  exports: [ChantierService, TimesheetService, PurchasingService],
})
export class SiteTrackingModule {}
