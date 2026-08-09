import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
  listLibraries(@Query() query: DataGridQuery, @Query('scope') scope?: string) {
    // Défaut « etude » : les écrans de chiffrage ne doivent pas voir les catalogues du chantier.
    return this.libraries.listLibraries(query, scope === 'chantier' ? 'chantier' : 'etude');
  }

  @Delete(':libraryId')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  deleteLibrary(@Param('libraryId') libraryId: string) {
    return this.libraries.deleteLibrary(libraryId);
  }

  @Post(':libraryId/resources')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  createResource(@Param('libraryId') libraryId: string, @Body() body: ResourceInput) {
    if (!body?.code || !body?.label || !body?.unit || !body?.nature) {
      throw new BadRequestException('Le code, la désignation, l’unité et le type sont obligatoires.');
    }
    if (!NATURES.includes(body.nature)) {
      throw new BadRequestException('Le type de ressource est invalide.');
    }
    return this.libraries.createResource(libraryId, body);
  }

  @Get(':libraryId/resources')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  listResources(@Param('libraryId') libraryId: string, @Query() query: DataGridQuery) {
    return this.libraries.listResources(libraryId, query);
  }

  @Get(':libraryId/resources/:resourceId')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  getResource(
    @Param('libraryId') libraryId: string,
    @Param('resourceId') resourceId: string,
  ) {
    return this.libraries.getResource(libraryId, resourceId);
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

  @Put(':libraryId/resources/:resourceId')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  updateResource(
    @Param('libraryId') libraryId: string,
    @Param('resourceId') resourceId: string,
    @Body() body: Partial<ResourceInput>,
  ) {
    if (body?.nature && !NATURES.includes(body.nature)) {
      throw new BadRequestException('Le type de ressource est invalide.');
    }
    return this.libraries.updateResource(libraryId, resourceId, body);
  }

  @Delete(':libraryId/resources/:resourceId')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  deleteResource(
    @Param('libraryId') libraryId: string,
    @Param('resourceId') resourceId: string,
  ) {
    return this.libraries.deleteResource(libraryId, resourceId);
  }

  @Put(':libraryId/resources/:resourceId/code-analytique')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  classifyResource(
    @Param('libraryId') libraryId: string,
    @Param('resourceId') resourceId: string,
    @Body() body: { codeAnalytiqueId?: string },
  ) {
    if (!body?.codeAnalytiqueId) {
      throw new BadRequestException('codeAnalytiqueId is required');
    }
    return this.libraries.classifyResource(libraryId, resourceId, body.codeAnalytiqueId);
  }
}
