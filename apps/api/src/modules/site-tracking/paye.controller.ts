import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { LigneManuelleInput, PayeService, RubriqueInput } from './paye.service';
import { RelevePdfService } from './releve-pdf.service';

/** Mois courant, quand l'appelant n'en précise pas — l'écran s'ouvre sur le mois en cours. */
function moisOuCourant(mois?: string): string {
  return mois ?? new Date().toISOString().slice(0, 7);
}

@Controller('paye')
export class PayeController {
  constructor(
    private readonly paye: PayeService,
    private readonly relevePdfService: RelevePdfService,
  ) {}

  /* ── paramétrage des rubriques ── */

  @Get('rubriques')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  listerRubriques(@Query('toutes') toutes?: string) {
    return this.paye.listerRubriques(toutes === '1' || toutes === 'true');
  }

  @Post('rubriques')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  creerRubrique(@Body() body: RubriqueInput) {
    return this.paye.creerRubrique(body);
  }

  @Patch('rubriques/:id')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  modifierRubrique(@Param('id') id: string, @Body() body: Partial<RubriqueInput>) {
    return this.paye.modifierRubrique(id, body);
  }

  @Delete('rubriques/:id')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  supprimerRubrique(@Param('id') id: string) {
    return this.paye.supprimerRubrique(id);
  }

  /* ── relevés mensuels ── */

  @Get('releves')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  releves(@Query('mois') mois?: string) {
    return this.paye.releves(moisOuCourant(mois));
  }

  @Get('releves/:employeeId')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  releve(@Param('employeeId') employeeId: string, @Query('mois') mois?: string) {
    return this.paye.releve(employeeId, moisOuCourant(mois));
  }

  @Post('releves/:employeeId/calculer')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  calculer(@Param('employeeId') employeeId: string, @Query('mois') mois?: string) {
    return this.paye.calculer(employeeId, moisOuCourant(mois));
  }

  @Post('releves/:employeeId/valider')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  valider(@Param('employeeId') employeeId: string, @Query('mois') mois?: string) {
    return this.paye.valider(employeeId, moisOuCourant(mois));
  }

  @Post('releves/:employeeId/signer')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  signer(
    @Param('employeeId') employeeId: string,
    @Body() body: { nom: string; signature?: string | null },
    @Query('mois') mois?: string,
  ) {
    return this.paye.signer(employeeId, moisOuCourant(mois), body?.nom, body?.signature ?? null);
  }

  /** Relevé mensuel en PDF — le document qu'on imprime, remet et classe. */
  @Get('releves/:employeeId/releve.pdf')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  async relevePdf(
    @Res() res: Response,
    @Param('employeeId') employeeId: string,
    @Query('mois') mois?: string,
  ) {
    const m = moisOuCourant(mois);
    const pdf = await this.relevePdfService.generer(employeeId, m);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="releve-${m}.pdf"`);
    res.send(pdf);
  }

  /**
   * Réouverture d'un relevé validé ou signé — `rbac.role.manage` sert de marqueur
   * d'administration, comme pour la réouverture d'une commande envoyée.
   */
  @Post('releves/:employeeId/rouvrir')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('rbac.role.manage')
  rouvrir(
    @Param('employeeId') employeeId: string,
    @Body() body: { motif?: string },
    @Query('mois') mois?: string,
  ) {
    return this.paye.rouvrir(employeeId, moisOuCourant(mois), body?.motif ?? null);
  }

  /* ── éléments variables saisis à la main ── */

  @Post('releves/:employeeId/lignes')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  ajouterLigne(
    @Param('employeeId') employeeId: string,
    @Body() body: LigneManuelleInput,
    @Query('mois') mois?: string,
  ) {
    return this.paye.ajouterLigne(employeeId, moisOuCourant(mois), body);
  }

  @Patch('lignes/:ligneId')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  modifierLigne(@Param('ligneId') ligneId: string, @Body() body: Partial<LigneManuelleInput>) {
    return this.paye.modifierLigne(ligneId, body);
  }

  @Delete('lignes/:ligneId')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  supprimerLigne(@Param('ligneId') ligneId: string) {
    return this.paye.supprimerLigne(ligneId);
  }

  /* ── export ── */

  @Get('export')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  async exporter(@Res() res: Response, @Query('mois') mois?: string) {
    const m = moisOuCourant(mois);
    const csv = await this.paye.exportCsv(m);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="paye-${m}.csv"`);
    res.send(csv);
  }
}
