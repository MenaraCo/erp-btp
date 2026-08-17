import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { EmployeeInput, EmployeeService } from './employee.service';
import { ContratInterimInput, InterimService } from './interim.service';

/**
 * Fichier des salariés (module Suivi de chantiers).
 *
 * Lecture ouverte à qui consulte le suivi — désigner un ouvrier sur un pointage ne doit pas
 * exiger les droits d'administration. L'écriture reste réservée à qui gère le suivi de chantiers.
 */
@Controller('employees')
export class EmployeeController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly interim: InterimService,
  ) {}

  @Get()
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  list(@Query('tous') tous?: string) {
    return this.employees.list(tous === '1' || tous === 'true');
  }

  @Post()
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  create(@Body() body: EmployeeInput) {
    return this.employees.create(body ?? {});
  }

  @Patch(':id')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  update(@Param('id') id: string, @Body() body: EmployeeInput) {
    return this.employees.update(id, body ?? {});
  }

  @Delete(':id')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  remove(@Param('id') id: string) {
    return this.employees.remove(id);
  }

  /* ── Contrats d'intérim : l'agence, ses termes, ce que l'heure coûte vraiment ── */

  @Get(':id/interim-contracts')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.read')
  contratsInterim(@Param('id') id: string) {
    return this.interim.contrats(id);
  }

  @Post(':id/interim-contracts')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  creerContratInterim(@Param('id') id: string, @Body() body: ContratInterimInput) {
    return this.interim.creer(id, body);
  }

  @Patch('interim-contracts/:contractId')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  modifierContratInterim(
    @Param('contractId') contractId: string,
    @Body() body: Partial<ContratInterimInput>,
  ) {
    return this.interim.modifier(contractId, body);
  }

  @Delete('interim-contracts/:contractId')
  @RequiresCapability('site_tracking.timesheet')
  @RequiresPermission('site_tracking.write')
  supprimerContratInterim(@Param('contractId') contractId: string) {
    return this.interim.supprimer(contractId);
  }
}
