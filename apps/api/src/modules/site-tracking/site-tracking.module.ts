import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { EstimatingModule } from '../estimating/estimating.module';
import { ChantierService } from './chantier.service';
import { ChantierController } from './chantier.controller';
import { TimesheetService } from './timesheet.service';
import { TimesheetController } from './timesheet.controller';

/**
 * Suivi de chantiers — 3.1 transfert → chantier, 3.2 contre-étude, 3.3 budget prévisionnel,
 * 3.4 pointages MO.
 */
@Module({
  imports: [TenancyModule, EstimatingModule],
  providers: [ChantierService, TimesheetService],
  controllers: [ChantierController, TimesheetController],
  exports: [ChantierService, TimesheetService],
})
export class SiteTrackingModule {}
