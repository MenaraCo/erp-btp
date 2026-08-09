import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { ChantierService } from './chantier.service';

@Controller()
export class ChantierController {
  constructor(private readonly chantiers: ChantierService) {}

  @Post('chantiers')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  create(@Body() body: { code?: string; name?: string }) {
    // Le code n'est plus exigé : il est attribué automatiquement par la numérotation société.
    if (!body?.name) {
      throw new BadRequestException('name is required');
    }
    return this.chantiers.createChantier({ code: body.code, name: body.name });
  }

  @Get('chantiers')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  list() {
    return this.chantiers.listChantiers();
  }

  @Get('chantiers/:chantierId')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  get(@Param('chantierId') chantierId: string) {
    return this.chantiers.getChantier(chantierId);
  }

  @Get('chantiers/:chantierId/marches')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  marches(@Param('chantierId') chantierId: string) {
    return this.chantiers.listMarches(chantierId);
  }

  @Get('chantiers/:chantierId/nomenclature')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  nomenclature(@Param('chantierId') chantierId: string) {
    return this.chantiers.listNomenclature(chantierId);
  }

  /** Ventilation analytique d'une ressource de chantier (sortie de « 999 — À ventiler »). */
  @Put('chantiers/:chantierId/nomenclature/:resourceId/code-analytique')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  ventile(
    @Param('chantierId') chantierId: string,
    @Param('resourceId') resourceId: string,
    @Body() body: { codeAnalytiqueId?: string | null },
  ) {
    return this.chantiers.ventileResource(chantierId, resourceId, body?.codeAnalytiqueId ?? null);
  }

  @Get('chantiers/:chantierId/execution-tree')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  executionTree(@Param('chantierId') chantierId: string) {
    return this.chantiers.executionTree(chantierId);
  }

  // --- Contre-étude ---

  @Put('chantiers/:chantierId/nomenclature/:resourceId')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  renegotiate(
    @Param('chantierId') chantierId: string,
    @Param('resourceId') resourceId: string,
    @Body() body: { unitCostObjectif?: string | number },
  ) {
    if (body?.unitCostObjectif == null || Number.isNaN(Number(body.unitCostObjectif))) {
      throw new BadRequestException('unitCostObjectif is required');
    }
    return this.chantiers.renegotiateResource(chantierId, resourceId, body.unitCostObjectif);
  }

  @Put('execution-components/:componentId/quantity')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  setComponentQuantity(
    @Param('componentId') componentId: string,
    @Body() body: { quantiteObjectif?: string | number },
  ) {
    if (body?.quantiteObjectif == null || Number.isNaN(Number(body.quantiteObjectif))) {
      throw new BadRequestException('quantiteObjectif is required');
    }
    return this.chantiers.setComponentQuantity(componentId, body.quantiteObjectif);
  }

  // --- Édition structurelle (prestations) ---

  @Post('execution-lines/:lineId/components')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  addResourceComponent(
    @Param('lineId') lineId: string,
    @Body() body: { code?: string; label?: string; unit?: string | null; nature?: string; unitCost?: string | number; quantity?: string | number },
  ) {
    if (!body?.code || !body?.label || !body?.nature || body?.unitCost == null || body?.quantity == null) {
      throw new BadRequestException('code, label, nature, unitCost and quantity are required');
    }
    return this.chantiers.addResourceComponent(lineId, {
      code: body.code, label: body.label, unit: body.unit ?? null,
      nature: body.nature, unitCost: body.unitCost, quantity: body.quantity,
    });
  }

  @Delete('execution-components/:componentId')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  removeComponent(@Param('componentId') componentId: string) {
    return this.chantiers.removeComponent(componentId);
  }

  @Post('marches/:marcheId/execution-lines')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  addOuvrageLine(
    @Param('marcheId') marcheId: string,
    @Body() body: { code?: string | null; designation?: string; unit?: string | null; quantiteObjectif?: string | number },
  ) {
    if (!body?.designation || body?.quantiteObjectif == null) {
      throw new BadRequestException('designation and quantiteObjectif are required');
    }
    return this.chantiers.addOuvrageLine(marcheId, {
      code: body.code ?? null, designation: body.designation,
      unit: body.unit ?? null, quantiteObjectif: body.quantiteObjectif,
    });
  }

  @Put('execution-lines/:lineId/quantity')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  setLineQuantity(
    @Param('lineId') lineId: string,
    @Body() body: { quantiteObjectif?: string | number },
  ) {
    if (body?.quantiteObjectif == null || Number.isNaN(Number(body.quantiteObjectif))) {
      throw new BadRequestException('quantiteObjectif is required');
    }
    return this.chantiers.setLineQuantity(lineId, body.quantiteObjectif);
  }

  @Delete('execution-lines/:lineId')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  removeLine(@Param('lineId') lineId: string) {
    return this.chantiers.removeLine(lineId);
  }

  @Post('marches/:marcheId/etude/validate')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  validateEtude(@Param('marcheId') marcheId: string) {
    return this.chantiers.validateEtude(marcheId);
  }

  @Post('marches/:marcheId/contre-etude/validate')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  validate(@Param('marcheId') marcheId: string) {
    return this.chantiers.validateContreEtude(marcheId);
  }

  @Get('marches/:marcheId/change-log')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  changeLog(@Param('marcheId') marcheId: string) {
    return this.chantiers.listChangeLog(marcheId);
  }

  // --- Budget prévisionnel ---

  @Put('execution-lines/:lineId/budget/:nature')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  setPrevisionnel(
    @Param('lineId') lineId: string,
    @Param('nature') nature: string,
    @Body() body: { montantPrevisionnel?: string | number },
  ) {
    if (body?.montantPrevisionnel == null || Number.isNaN(Number(body.montantPrevisionnel))) {
      throw new BadRequestException('montantPrevisionnel is required');
    }
    return this.chantiers.setPrevisionnel(lineId, nature, body.montantPrevisionnel);
  }
}
