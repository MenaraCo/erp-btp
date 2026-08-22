import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { ActivityModule } from '../../core/activity/activity.module';
import { EstimatingModule } from '../estimating/estimating.module';
import { SiteTrackingModule } from '../site-tracking/site-tracking.module';
import { AcceptanceService } from './acceptance.service';
import { AcceptanceController } from './acceptance.controller';
import { SituationsService } from './situations.service';
import { SituationsController } from './situations.controller';
import { AvenantService } from './avenant.service';
import { AvenantController } from './avenant.controller';
import { DocumentPdfService } from './document-pdf.service';
import { DgdService } from './dgd.service';
import { DgdController } from './dgd.controller';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceController } from './invoice.controller';

/** Invoicing — 2.1 acceptation, 2.2 situations, 2.3 avenants, 2.4 DGD, 2.5 sociétés + factures. */
@Module({
  imports: [TenancyModule, ActivityModule, EstimatingModule, SiteTrackingModule],
  providers: [
    AcceptanceService,
    SituationsService,
    AvenantService,
    DgdService,
    CompanyService,
    InvoiceService, DocumentPdfService],
  controllers: [
    AcceptanceController,
    SituationsController,
    AvenantController,
    DgdController,
    CompanyController,
    InvoiceController,
  ],
  exports: [
    AcceptanceService,
    SituationsService,
    AvenantService,
    DgdService,
    CompanyService,
    InvoiceService,
  ],
})
export class InvoicingModule {}
