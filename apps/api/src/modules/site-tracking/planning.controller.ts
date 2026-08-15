import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { DuplicationInput, PlanningService } from './planning.service';

/**
 * Calendrier des heures d'un chantier : réalisé et prévisionnel dans la même grille.
 * Le prévisionnel est planifié à part et n'entre dans aucun résultat tant qu'il n'a pas eu lieu.
 */
@Controller('chantiers/:chantierId/planning')
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  @Get()
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  calendrier(
    @Param('chantierId') chantierId: string,
    @Query('debut') debut: string,
    @Query('fin') fin: string,
  ) {
    return this.planning.calendrier(chantierId, debut, fin);
  }

  /** Une case de prévisionnel. `hours: 0` efface la prévision. */
  @Put('previsionnel')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  planifier(
    @Param('chantierId') chantierId: string,
    @Body() body: { employeeId?: string; date?: string; hours?: string | number },
  ) {
    if (!body?.employeeId || !body?.date) {
      throw new BadRequestException('Le salarié et la date sont requis.');
    }
    return this.planning.planifier(chantierId, body.employeeId, body.date, body.hours ?? 0);
  }

  /** Une case de réalisé, saisie directement dans la grille. */
  @Put('realise')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  saisir(
    @Param('chantierId') chantierId: string,
    @Body() body: { employeeId?: string; date?: string; hours?: string | number },
  ) {
    if (!body?.employeeId || !body?.date) {
      throw new BadRequestException('Le salarié et la date sont requis.');
    }
    return this.planning.saisirRealise(chantierId, body.employeeId, body.date, body.hours ?? 0);
  }

  /** Duplique une journée type sur une semaine, un mois… (jours ouvrés par défaut). */
  @Post('dupliquer')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  dupliquer(@Param('chantierId') chantierId: string, @Body() body: DuplicationInput) {
    if (!body?.employeeId || !body?.debut || !body?.fin) {
      throw new BadRequestException('Le salarié et la période sont requis.');
    }
    return this.planning.dupliquerPrevisionnel(chantierId, body);
  }

  /** « La semaine s'est passée comme prévu » : reporte le prévisionnel en heures réelles. */
  @Post('reporter')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  reporter(
    @Param('chantierId') chantierId: string,
    @Body() body: { debut?: string; fin?: string },
  ) {
    if (!body?.debut || !body?.fin) throw new BadRequestException('La période est requise.');
    return this.planning.reporterEnRealise(chantierId, body.debut, body.fin);
  }
}
