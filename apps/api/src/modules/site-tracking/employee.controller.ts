import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { EmployeeInput, EmployeeService } from './employee.service';

/**
 * Fichier des salariés (module Suivi de chantiers).
 *
 * Lecture ouverte à qui consulte le suivi — désigner un ouvrier sur un pointage ne doit pas
 * exiger les droits d'administration. L'écriture reste réservée à qui gère le suivi de chantiers.
 */
@Controller('employees')
export class EmployeeController {
  constructor(private readonly employees: EmployeeService) {}

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
}
