import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { DataGridQuery } from '../../core/common/data-grid/data-grid';
import {
  LibrariesService,
  LibraryInput,
  ResourceInput,
} from './libraries.service';

const NATURES = ['labor', 'material', 'equipment', 'subcontract'];

/** Library/resource endpoints, gated by the estimating capability + RBAC permission. */
@Controller('libraries')
export class LibrariesController {
  constructor(private readonly libraries: LibrariesService) {}

  @Post()
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  createLibrary(@Body() body: LibraryInput) {
    if (!body?.code || !body?.name) {
      throw new BadRequestException('code and name are required');
    }
    return this.libraries.createLibrary(body);
  }

  @Get()
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  listLibraries(@Query() query: DataGridQuery) {
    return this.libraries.listLibraries(query);
  }

  @Post(':libraryId/resources')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  createResource(@Param('libraryId') libraryId: string, @Body() body: ResourceInput) {
    if (!body?.code || !body?.label || !body?.unit || !body?.nature) {
      throw new BadRequestException('code, label, unit and nature are required');
    }
    if (!NATURES.includes(body.nature)) {
      throw new BadRequestException(`nature must be one of ${NATURES.join(', ')}`);
    }
    return this.libraries.createResource(libraryId, body);
  }

  @Get(':libraryId/resources')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  listResources(@Param('libraryId') libraryId: string, @Query() query: DataGridQuery) {
    return this.libraries.listResources(libraryId, query);
  }

  @Patch(':libraryId/resources/:resourceId')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  updateResourceCost(
    @Param('libraryId') libraryId: string,
    @Param('resourceId') resourceId: string,
    @Body() body: { unitCost?: string | number },
  ) {
    if (body?.unitCost == null || Number.isNaN(Number(body.unitCost))) {
      throw new BadRequestException('unitCost is required');
    }
    return this.libraries.updateResourceCost(libraryId, resourceId, body.unitCost);
  }
}
