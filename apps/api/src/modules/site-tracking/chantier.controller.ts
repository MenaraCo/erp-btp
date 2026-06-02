import { Controller, Get, Param, Post } from '@nestjs/common';
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
}
