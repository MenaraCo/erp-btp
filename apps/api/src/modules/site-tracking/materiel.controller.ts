import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import {
  AffectationInput, MaterielInput, MaterielService, UtilisationInput,
} from './materiel.service';

/**
 * Parc matériel — vue d'ENTREPRISE : un engin n'appartient pas à un chantier, il s'y déplace.
 * Les capacités sont celles du suivi de chantiers : c'est le même métier, pas un module vendu à
 * part.
 */
@Controller('materiel')
export class MaterielController {
  constructor(private readonly materiel: MaterielService) {}

  @Get()
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  liste(@Query('tous') tous?: string) {
    return this.materiel.liste(tous === '1' || tous === 'true');
  }

  @Post()
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  creer(@Body() body: MaterielInput) {
    return this.materiel.creer(body);
  }

  /** Échéances d'entretien à venir — déclaré avant `:id`, sinon « echeances » serait pris pour un id. */
  @Get('echeances')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  echeances(@Query('jours') jours?: string) {
    return this.materiel.echeances(jours ? Number(jours) : 30);
  }

  @Get('affectations')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  affectations(
    @Query('debut') debut: string,
    @Query('fin') fin: string,
    @Query('materiel') equipmentId?: string,
    @Query('chantier') chantierId?: string,
  ) {
    return this.materiel.affectations(debut, fin, equipmentId ?? null, chantierId ?? null);
  }

  /** Relevés d'utilisation d'un chantier — l'écran matériel DU chantier lit ici. */
  @Get('utilisations')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  utilisationsChantier(
    @Query('chantier') chantierId: string,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
  ) {
    return this.materiel.utilisationsChantier(chantierId, debut ?? null, fin ?? null);
  }

  @Get('conflits')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  conflits(@Query('debut') debut: string, @Query('fin') fin: string) {
    return this.materiel.conflits(debut, fin);
  }

  @Patch(':id')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  modifier(@Param('id') id: string, @Body() body: MaterielInput) {
    return this.materiel.modifier(id, body);
  }

  @Delete(':id')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  supprimer(@Param('id') id: string) {
    return this.materiel.supprimer(id);
  }

  @Post(':id/affectations')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  affecter(@Param('id') id: string, @Body() body: AffectationInput) {
    return this.materiel.affecter(id, body);
  }

  @Delete('affectations/:affectationId')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  retirerAffectation(@Param('affectationId') affectationId: string) {
    return this.materiel.retirerAffectation(affectationId);
  }

  @Get(':id/utilisations')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  utilisations(
    @Param('id') id: string,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
  ) {
    return this.materiel.utilisations(id, debut ?? null, fin ?? null);
  }

  @Post(':id/utilisations')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  relever(@Param('id') id: string, @Body() body: UtilisationInput) {
    return this.materiel.releverUtilisation(id, body);
  }

  @Delete('utilisations/:usageId')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  supprimerUtilisation(@Param('usageId') usageId: string) {
    return this.materiel.supprimerUtilisation(usageId);
  }
}
