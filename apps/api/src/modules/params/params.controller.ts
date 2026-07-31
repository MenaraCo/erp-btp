import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import {
  CodeInput,
  CompanyInfoInput,
  FamilleInput,
  LotInput,
  ParamsService,
  PreferencesInput,
  UnitInput,
} from './params.service';

/**
 * Menu Paramètres — référentiels paramétrables par société.
 *
 * Gating : la permission RBAC suffit (estimating.devis.read / write).
 * La visibilité des onglets dans l'UI est gérée côté frontend selon les modules souscrits
 * (estimating.bid → Unités/Lots/Familles/Codes ; facturation → Numérotation factures ; etc.)
 * On ne gate PAS par @RequiresCapability ici car c'est un espace d'administration globale
 * société (le gérant configure sans avoir forcément un seat utilisateur).
 */
@Controller('params')
export class ParamsController {
  constructor(private readonly params: ParamsService) {}

  /* ===================== ENTREPRISE ===================== */

  @Get('company')
  @RequiresPermission('estimating.devis.read')
  getCompany() {
    return this.params.getCompany();
  }

  @Patch('company/:id')
  @RequiresPermission('estimating.devis.write')
  updateCompany(@Param('id') id: string, @Body() body: CompanyInfoInput) {
    return this.params.updateCompany(id, body);
  }

  /* ---- Logo d'entreprise (éditions) ---- */

  @Get('company/logo')
  @RequiresPermission('estimating.devis.read')
  @Header('Cache-Control', 'no-cache')
  async getCompanyLogo(@Res() res: Response) {
    const logo = await this.params.getCompanyLogo();
    if (!logo) {
      throw new NotFoundException('Aucun logo enregistré.');
    }
    res.setHeader('Content-Type', logo.mime);
    res.send(logo.data);
  }

  @Put('company/:id/logo')
  @RequiresPermission('estimating.devis.write')
  setCompanyLogo(@Param('id') id: string, @Body() body: { data: string; mime: string }) {
    return this.params.setCompanyLogo(id, body?.data, body?.mime);
  }

  @Delete('company/:id/logo')
  @RequiresPermission('estimating.devis.write')
  deleteCompanyLogo(@Param('id') id: string) {
    return this.params.deleteCompanyLogo(id);
  }

  /* ===================== PRÉFÉRENCES ===================== */

  @Get('preferences')
  @RequiresPermission('estimating.devis.read')
  getPreferences() {
    return this.params.getPreferences();
  }

  @Patch('preferences')
  @RequiresPermission('estimating.devis.write')
  updatePreferences(@Body() body: PreferencesInput) {
    return this.params.updatePreferences(body);
  }

  /* ===================== UNITÉS ===================== */

  @Get('units')
  @RequiresPermission('estimating.devis.read')
  listUnits() {
    return this.params.listUnits();
  }

  @Post('units')
  @RequiresPermission('estimating.devis.write')
  createUnit(@Body() body: UnitInput) {
    return this.params.createUnit(body);
  }

  @Patch('units/:id')
  @RequiresPermission('estimating.devis.write')
  updateUnit(@Param('id') id: string, @Body() body: Partial<UnitInput>) {
    return this.params.updateUnit(id, body);
  }

  @Delete('units/:id')
  @RequiresPermission('estimating.devis.write')
  deleteUnit(@Param('id') id: string) {
    return this.params.deleteUnit(id);
  }

  @Put('units/reorder')
  @RequiresPermission('estimating.devis.write')
  reorderUnits(@Body() body: { ids: string[] }) {
    return this.params.reorderUnits(body.ids);
  }

  /* ===================== LOTS ===================== */

  @Get('lots')
  @RequiresPermission('estimating.devis.read')
  listLots() {
    return this.params.listLots();
  }

  @Post('lots')
  @RequiresPermission('estimating.devis.write')
  createLot(@Body() body: LotInput) {
    return this.params.createLot(body);
  }

  @Patch('lots/:id')
  @RequiresPermission('estimating.devis.write')
  updateLot(@Param('id') id: string, @Body() body: Partial<LotInput>) {
    return this.params.updateLot(id, body);
  }

  @Delete('lots/:id')
  @RequiresPermission('estimating.devis.write')
  deleteLot(@Param('id') id: string) {
    return this.params.deleteLot(id);
  }

  /* ===================== FAMILLES ===================== */

  @Get('familles')
  @RequiresPermission('estimating.devis.read')
  listFamilles() {
    return this.params.listFamilles();
  }

  @Post('familles')
  @RequiresPermission('estimating.devis.write')
  createFamille(@Body() body: FamilleInput) {
    return this.params.createFamille(body);
  }

  @Patch('familles/:id')
  @RequiresPermission('estimating.devis.write')
  updateFamille(@Param('id') id: string, @Body() body: Partial<FamilleInput>) {
    return this.params.updateFamille(id, body);
  }

  @Delete('familles/:id')
  @RequiresPermission('estimating.devis.write')
  deleteFamille(@Param('id') id: string) {
    return this.params.deleteFamille(id);
  }

  /* ===================== CODES ANALYTIQUES ===================== */

  @Get('codes')
  @RequiresPermission('estimating.devis.read')
  listCodes() {
    return this.params.listCodes();
  }

  @Post('codes')
  @RequiresPermission('estimating.devis.write')
  createCode(@Body() body: CodeInput) {
    return this.params.createCode(body);
  }

  @Patch('codes/:id')
  @RequiresPermission('estimating.devis.write')
  updateCode(@Param('id') id: string, @Body() body: Partial<CodeInput>) {
    return this.params.updateCode(id, body);
  }

  @Delete('codes/:id')
  @RequiresPermission('estimating.devis.write')
  deleteCode(@Param('id') id: string) {
    return this.params.deleteCode(id);
  }
}
