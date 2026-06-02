import { Controller, Get, Param, Post } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { AcceptanceService } from './acceptance.service';

@Controller()
export class AcceptanceController {
  constructor(private readonly acceptance: AcceptanceService) {}

  @Post('affaires/:affaireId/transfer')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.write')
  transfer(@Param('affaireId') affaireId: string) {
    return this.acceptance.transfer(affaireId);
  }

  @Get('marches')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  list() {
    return this.acceptance.listMarches();
  }

  @Get('marches/:marcheId')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  get(@Param('marcheId') marcheId: string) {
    return this.acceptance.getMarche(marcheId);
  }
}
