import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query,
} from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { TimesheetInput, TimesheetService } from './timesheet.service';

@Controller('chantiers/:chantierId/timesheets')
export class TimesheetController {
  constructor(private readonly timesheets: TimesheetService) {}

  @Post()
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  create(@Param('chantierId') chantierId: string, @Body() body: TimesheetInput) {
    // Un salarié du fichier OU un nom saisi ; des heures OU un créneau horaire dont on déduira
    // la durée. Exiger les deux obligerait à retaper une information déjà donnée.
    const duree = body?.hours != null || (body?.startTime && body?.endTime);
    if ((!body?.employeeId && !body?.employee) || !body?.date || !duree) {
      throw new BadRequestException(
        'Le salarié, la date et la durée (heures ou créneau) sont requis.',
      );
    }
    return this.timesheets.create(chantierId, body);
  }

  @Get()
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  list(
    @Param('chantierId') chantierId: string,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
  ) {
    return this.timesheets.list(chantierId, debut ?? null, fin ?? null);
  }

  @Get('summary')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  summary(@Param('chantierId') chantierId: string) {
    return this.timesheets.summary(chantierId);
  }
  /**
   * Contrôle du pointage d'un mois : grille salarié × jour, totaux et anomalies.
   * À relire AVANT d'imputer — après, les heures sont figées.
   */
  @Get('controle')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  controle(@Param('chantierId') chantierId: string, @Query('mois') mois: string) {
    return this.timesheets.controle(chantierId, mois);
  }

  /** Arrête les heures du mois : elles ne se modifient plus. */
  @Post('imputation')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  imputer(@Param('chantierId') chantierId: string, @Body() body: { mois?: string }) {
    if (!body?.mois) throw new BadRequestException('Le mois à imputer est requis (AAAA-MM).');
    return this.timesheets.imputer(chantierId, body.mois);
  }

  /** Corrige un pointage non imputé. */
  @Patch(':timesheetId')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  update(@Param('timesheetId') timesheetId: string, @Body() body: TimesheetInput) {
    return this.timesheets.update(timesheetId, body ?? {});
  }

  /** Supprime un pointage non imputé (mauvais chantier, doublon…). */
  @Delete(':timesheetId')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  remove(@Param('timesheetId') timesheetId: string) {
    return this.timesheets.remove(timesheetId);
  }
}
