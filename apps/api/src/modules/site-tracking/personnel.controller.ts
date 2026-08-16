import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { PersonnelService } from './personnel.service';
import { AbsenceService, type AbsenceInput } from './absence.service';
import { AbsencesPdfService } from './absences-pdf.service';

/** Les deux seuls types de créneaux déplaçables : le reste (absences) a ses propres routes. */
function typeDeCreneau(kind: string): 'realise' | 'prevu' {
  if (kind !== 'realise' && kind !== 'prevu') {
    throw new BadRequestException('Type de créneau inconnu (realise ou prevu).');
  }
  return kind;
}

/**
 * Gestion du personnel — vue d'ENTREPRISE, tous chantiers confondus.
 * Un salarié n'appartient pas à un chantier : il se répartit. C'est ici qu'on le voit.
 */
@Controller('personnel')
export class PersonnelController {
  constructor(
    private readonly personnel: PersonnelService,
    private readonly absences: AbsenceService,
    private readonly absencesPdf: AbsencesPdfService,
  ) {}

  @Get('occupation')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  occupation(
    @Query('debut') debut: string,
    @Query('fin') fin: string,
    @Query('salarie') employeeId?: string,
    @Query('chantier') chantierId?: string,
    @Query('contrat') contractType?: string,
  ) {
    return this.personnel.occupation({ debut, fin, employeeId, chantierId, contractType });
  }

  /** Les journées à vérifier : double pointage, chevauchement de chantiers, cumul impossible. */
  @Get('conflits')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  conflits(@Query('debut') debut: string, @Query('fin') fin: string) {
    return this.personnel.conflits(debut, fin);
  }
  /** Créneaux individuels — ce que la vue calendrier affiche et déplace à la souris. */
  @Get('creneaux')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  creneaux(
    @Query('debut') debut: string,
    @Query('fin') fin: string,
    @Query('salarie') employeeId?: string,
    @Query('chantier') chantierId?: string,
    @Query('contrat') contractType?: string,
  ) {
    return this.personnel.creneaux({ debut, fin, employeeId, chantierId, contractType });
  }

  /** Saisie directe depuis le calendrier : « 8 h–12 h sur ce chantier, pour cette personne ». */
  @Post('creneaux')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  creer(
    @Body() body: {
      kind?: string; employeeId?: string; chantierId?: string; date?: string;
      heures?: string | number | null; debut?: string | null; fin?: string | null;
      executionLineId?: string | null; codeAnalytiqueId?: string | null;
    },
  ) {
    return this.personnel.creer({
      kind: typeDeCreneau(body?.kind ?? 'realise'),
      employeeId: body?.employeeId ?? '',
      chantierId: body?.chantierId ?? '',
      date: body?.date ?? '',
      heures: body?.heures ?? null,
      debut: body?.debut ?? null,
      fin: body?.fin ?? null,
      executionLineId: body?.executionLineId ?? null,
      codeAnalytiqueId: body?.codeAnalytiqueId ?? null,
    });
  }

  /**
   * Modifie un créneau : jour (glisser-déposer), horaire, durée ou chantier.
   * Les champs absents ne changent pas — corriger l'heure ne doit pas déplacer la journée.
   */
  @Patch('creneaux/:kind/:id')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  deplacer(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: {
      date?: string; debut?: string | null; fin?: string | null;
      heures?: string | number | null; chantierId?: string | null;
      executionLineId?: string | null; codeAnalytiqueId?: string | null;
    },
  ) {
    return this.personnel.deplacer(typeDeCreneau(kind), id, body ?? {});
  }

  /** Retire un créneau — « cette personne n'était pas sur ce chantier ce jour-là ». */
  @Delete('creneaux/:kind/:id')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  supprimer(@Param('kind') kind: string, @Param('id') id: string) {
    return this.personnel.supprimer(typeDeCreneau(kind), id);
  }

  // --- Congés et absences ---

  @Get('absences')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  listeAbsences(
    @Query('debut') debut: string,
    @Query('fin') fin: string,
    @Query('salarie') employeeId?: string,
    @Query('motif') motif?: string,
  ) {
    return this.absences.list(debut, fin, employeeId ?? null, motif ?? null);
  }

  /** Relevé d'absences en PDF : le document qu'on classe ou qu'on transmet à la paye. */
  @Get('absences/export.pdf')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  async exporterAbsencesPdf(
    @Res() res: Response,
    @Query('debut') debut: string,
    @Query('fin') fin: string,
    @Query('salarie') employeeId?: string,
    @Query('motif') motif?: string,
  ) {
    const pdf = await this.absencesPdf.releve(debut, fin, employeeId ?? null, motif ?? null);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="absences-${debut}_${fin}.pdf"`);
    res.send(pdf);
  }

  /** Pose une absence, sur un jour ou sur toute une période (congés d'une semaine). */
  @Post('absences')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  poserAbsence(@Body() body: Partial<AbsenceInput>) {
    return this.absences.create({
      employeeId: body?.employeeId ?? '',
      kind: body?.kind ?? '',
      debut: body?.debut ?? '',
      fin: body?.fin ?? null,
      hours: body?.hours ?? null,
      startTime: body?.startTime ?? null,
      endTime: body?.endTime ?? null,
      comment: body?.comment ?? null,
      joursOuvres: body?.joursOuvres,
    });
  }

  @Patch('absences/:id')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  corrigerAbsence(
    @Param('id') id: string,
    @Body() body: Partial<AbsenceInput> & { date?: string },
  ) {
    return this.absences.update(id, body ?? {});
  }

  @Delete('absences/:id')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  retirerAbsence(@Param('id') id: string) {
    return this.absences.remove(id);
  }
}
