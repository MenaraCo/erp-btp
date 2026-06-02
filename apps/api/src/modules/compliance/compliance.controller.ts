import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { FacturXService } from './factur-x.service';
import { EInvoiceService } from './einvoice.service';

@Controller('invoices/:invoiceId')
export class ComplianceController {
  constructor(
    private readonly facturX: FacturXService,
    private readonly einvoice: EInvoiceService,
  ) {}

  @Get('cii.xml')
  @RequiresCapability('einvoicing.facturx')
  @RequiresPermission('invoicing.read')
  async cii(@Param('invoiceId') invoiceId: string, @Res() res: Response) {
    const xml = await this.facturX.buildXml(invoiceId);
    res.set({ 'Content-Type': 'application/xml; charset=utf-8' });
    res.send(xml);
  }

  @Get('factur-x.pdf')
  @RequiresCapability('einvoicing.facturx')
  @RequiresPermission('invoicing.read')
  async facturXPdf(@Param('invoiceId') invoiceId: string, @Res() res: Response) {
    const pdf = await this.facturX.buildPdf(invoiceId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="factur-x-${invoiceId}.pdf"`,
      'Content-Length': String(pdf.length),
    });
    res.end(pdf);
  }

  @Get('einvoice')
  @RequiresCapability('einvoicing.facturx')
  @RequiresPermission('invoicing.read')
  status(@Param('invoiceId') invoiceId: string) {
    return this.einvoice.get(invoiceId);
  }

  @Post('einvoice/submit')
  @RequiresCapability('einvoicing.facturx')
  @RequiresPermission('invoicing.write')
  submit(@Param('invoiceId') invoiceId: string) {
    return this.einvoice.submitToChorusPro(invoiceId);
  }

  @Post('einvoice/transition')
  @RequiresCapability('einvoicing.facturx')
  @RequiresPermission('invoicing.write')
  transition(@Param('invoiceId') invoiceId: string, @Body() body: { to?: string }) {
    if (!body?.to) {
      throw new BadRequestException('to (target status) is required');
    }
    return this.einvoice.transition(invoiceId, body.to);
  }
}
