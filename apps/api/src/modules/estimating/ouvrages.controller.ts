import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { DataGridQuery } from '../../core/common/data-grid/data-grid';
import {
  ComponentInput,
  OuvrageInput,
  OuvragesService,
} from './ouvrages.service';

@Controller()
export class OuvragesController {
  constructor(private readonly ouvrages: OuvragesService) {}

  @Post('libraries/:libraryId/ouvrages')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  create(@Param('libraryId') libraryId: string, @Body() body: OuvrageInput) {
    if (!body?.code || !body?.label || !body?.unit) {
      throw new BadRequestException('code, label and unit are required');
    }
    return this.ouvrages.createOuvrage(libraryId, body);
  }

  @Get('libraries/:libraryId/ouvrages')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  list(@Param('libraryId') libraryId: string, @Query() query: DataGridQuery) {
    return this.ouvrages.listOuvrages(libraryId, query);
  }

  @Get('ouvrages/:id')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  get(@Param('id') id: string) {
    return this.ouvrages.getOuvrage(id);
  }

  @Post('ouvrages/:id/components')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  addComponent(@Param('id') id: string, @Body() body: ComponentInput) {
    if (!body?.kind) {
      throw new BadRequestException('kind is required');
    }
    return this.ouvrages.addComponent(id, body);
  }
}
