import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { NumberingModule } from '../../core/numbering/numbering.module';
import { EstimatingModule } from '../estimating/estimating.module';
import { ChantierService } from './chantier.service';
import { ChantierController } from './chantier.controller';
import { TimesheetService } from './timesheet.service';
import { TimesheetController } from './timesheet.controller';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';
import { AnalyticsService } from './analytics.service';
import { LibraryTransferService } from './library-transfer.service';
import { LibraryTransferController } from './library-transfer.controller';
import { AnalyticsController } from './analytics.controller';

/**
 * Suivi de chantiers — 3.1 transfert → chantier, 3.2 contre-étude, 3.3 budget prévisionnel,
 * 3.4 pointages MO, 3.5 chaîne des achats, 3.6 résultats analytiques.
 */
@Module({
  imports: [TenancyModule, NumberingModule, EstimatingModule],
  providers: [ChantierService, TimesheetService, PurchasingService, AnalyticsService, LibraryTransferService],
  controllers: [
    ChantierController,
    TimesheetController,
    PurchasingController,
    AnalyticsController,
    LibraryTransferController,
  ],
  exports: [ChantierService, TimesheetService, PurchasingService, AnalyticsService],
})
export class SiteTrackingModule {}
