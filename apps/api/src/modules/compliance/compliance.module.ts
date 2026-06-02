import { Module } from '@nestjs/common';
import { TenancyModule } from '../../core/tenancy/tenancy.module';
import { FacturXService } from './factur-x.service';
import { EInvoiceService } from './einvoice.service';
import { ComplianceController } from './compliance.controller';

/**
 * Dedicated, versioned compliance module (cahier des charges §7): Factur-X (CII XML + PDF),
 * e-invoice lifecycle, Chorus Pro (stub), and VAT rules — all fiscal/legal logic isolated here.
 */
@Module({
  imports: [TenancyModule],
  providers: [FacturXService, EInvoiceService],
  controllers: [ComplianceController],
  exports: [FacturXService, EInvoiceService],
})
export class ComplianceModule {}
