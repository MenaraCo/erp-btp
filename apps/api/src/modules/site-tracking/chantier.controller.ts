import { BadRequestException, Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
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
    if (!body?.code || !body?.name) {
      throw new BadRequestException('code and name are required');
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
