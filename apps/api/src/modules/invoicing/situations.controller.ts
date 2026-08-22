import { BadRequestException, Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { SituationInput, SituationsService } from './situations.service';
import { DocumentPdfService } from './document-pdf.service';

@Controller()
export class SituationsController {
  constructor(
    private readonly situations: SituationsService,
    private readonly documents: DocumentPdfService,
  ) {}

  @Post('marches/:marcheId/situations')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.write')
  create(@Param('marcheId') marcheId: string, @Body() body: SituationInput) {
    if (!Array.isArray(body?.lines)) {
      throw new BadRequestException('lines[] is required');
    }
    return this.situations.createSituation(marcheId, body);
  }

  @Get('marches/:marcheId/situations')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  list(@Param('marcheId') marcheId: string) {
    return this.situations.listSituations(marcheId);
  }

  @Get('situations/:situationId')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  get(@Param('situationId') situationId: string) {
    return this.situations.getSituation(situationId);
  }

  /**
   * La situation, telle qu'elle part au client : en-tête de la société, avancement poste par
   * poste, et le chemin jusqu'au net à payer. C'est le document, pas un relevé d'écran.
   */
  @Get('situations/:situationId/situation.pdf')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  async situationPdf(@Param('situationId') situationId: string, @Res() res: Response) {
    const pdf = await this.documents.situationPdf(situationId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="situation-${situationId}.pdf"`);
    res.end(pdf);
  }

  /** Le décompte général définitif : ce qui solde le marché, dans le modèle de la société. */
  @Get('dgd/:dgdId/dgd.pdf')
  @RequiresCapability('invoicing.dgd')
  @RequiresPermission('invoicing.read')
  async dgdPdf(@Param('dgdId') dgdId: string, @Res() res: Response) {
    const pdf = await this.documents.dgdPdf(dgdId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="dgd-${dgdId}.pdf"`);
    res.end(pdf);
  }
}
