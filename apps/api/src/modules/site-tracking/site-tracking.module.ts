import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { NumberingModule } from '../../core/numbering/numbering.module';
import { MailerModule } from '../../core/mailer/mailer.module';
import { EstimatingModule } from '../estimating/estimating.module';
import { ChantierService } from './chantier.service';
import { ChantierController } from './chantier.controller';
import { EmployeeService } from './employee.service';
import { PlanningService } from './planning.service';
import { PersonnelService } from './personnel.service';
import { AbsenceService } from './absence.service';
import { ApprovisionnementService } from './approvisionnement.service';
import { AchatsRegistreService } from './achats-registre.service';
import { ValidationAchatsService } from './validation-achats.service';
import { RapprochementService } from './rapprochement.service';
import { CommandePdfService } from './commande-pdf.service';
import { PersonnelController } from './personnel.controller';
import { PlanningController } from './planning.controller';
import { EmployeeController } from './employee.controller';
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
  imports: [TenancyModule, NumberingModule, MailerModule, EstimatingModule],
  providers: [ChantierService, TimesheetService,
    EmployeeService,
    PlanningService,
    PersonnelService, AbsenceService, PurchasingService, ApprovisionnementService,
    AchatsRegistreService, ValidationAchatsService, RapprochementService, CommandePdfService,
    AnalyticsService, LibraryTransferService],
  controllers: [
    ChantierController,
    TimesheetController,
    EmployeeController,
    PlanningController,
    PersonnelController,
    PurchasingController,
    AnalyticsController,
    LibraryTransferController,
  ],
  exports: [ChantierService, TimesheetService,
    EmployeeService,
    PlanningService,
    PersonnelService, AbsenceService, PurchasingService, ApprovisionnementService,
    AchatsRegistreService, ValidationAchatsService, RapprochementService, CommandePdfService,
    AnalyticsService],
})
export class SiteTrackingModule {}
