import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { DebourseTypeInput, DebourseTypeService } from './debourse-type.service';

/**
 * Référentiel des types de déboursé : données d'étude de prix (elles portent les % FG et bénéfice
 * du chiffrage), donc gardées par la capacité du module Études de prix.
 */
@Controller('debourse-types')
export class DebourseTypeController {
  constructor(private readonly types: DebourseTypeService) {}

  @Get()
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  list(@Query('devisVersionId') devisVersionId?: string) {
    return this.types.list(devisVersionId ?? null);
  }

  @Post()
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  create(@Body() body: DebourseTypeInput) {
    return this.types.create(body);
  }

  @Put(':id')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  update(@Param('id') id: string, @Body() body: Partial<DebourseTypeInput>) {
    return this.types.update(id, body);
  }

  /** Remonte un type créé pour un devis au référentiel de la société. */
  @Post(':id/promote')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  promote(@Param('id') id: string) {
    return this.types.promote(id);
  }

  @Delete(':id')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  remove(@Param('id') id: string) {
    return this.types.remove(id);
  }
}
