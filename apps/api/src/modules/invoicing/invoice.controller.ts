import { BadRequestException, Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DocumentPdfService } from './document-pdf.service';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { GenerateInvoiceInput, InvoiceService } from './invoice.service';


@Controller()
export class InvoiceController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly documents: DocumentPdfService,
  ) {}

  @Post('situations/:situationId/invoice')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.write')
  generate(@Param('situationId') situationId: string, @Body() body: GenerateInvoiceInput) {
    if (!body?.companyId) {
      throw new BadRequestException('companyId is required');
    }
    return this.invoices.generateFromSituation(situationId, body);
  }

  @Get('invoices/:invoiceId')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  get(@Param('invoiceId') invoiceId: string) {
    return this.invoices.getInvoice(invoiceId);
  }

  @Get('companies/:companyId/invoices')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  listByCompany(@Param('companyId') companyId: string) {
    return this.invoices.listByCompany(companyId);
  }

  /** La facture, éditée dans le modèle de document choisi par la société. */
  @Get('invoices/:invoiceId/facture.pdf')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  async facturePdf(@Param('invoiceId') id: string, @Res() res: Response) {
    const pdf = await this.documents.facturePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="facture-${id}.pdf"`);
    res.end(pdf);
  }
}
