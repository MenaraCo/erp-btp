import { BadRequestException, Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { ChantierService } from './chantier.service';

@Controller()
export class ChantierController {
  constructor(private readonly chantiers: ChantierService) {}

  @Post('affaires/:affaireId/transfer-to-chantier')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  transfer(@Param('affaireId') affaireId: string) {
    return this.chantiers.transferFromAffaire(affaireId);
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

  @Post('chantiers/:chantierId/contre-etude/validate')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  validate(@Param('chantierId') chantierId: string) {
    return this.chantiers.validateContreEtude(chantierId);
  }
}
