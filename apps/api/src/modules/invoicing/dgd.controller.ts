import { Controller, Get, Param, Post } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { DgdService } from './dgd.service';

@Controller('marches/:marcheId/dgd')
export class DgdController {
  constructor(private readonly dgd: DgdService) {}

  @Post()
  @RequiresCapability('invoicing.dgd')
  @RequiresPermission('invoicing.write')
  generate(@Param('marcheId') marcheId: string) {
    return this.dgd.generate(marcheId);
  }

  @Get()
  @RequiresCapability('invoicing.dgd')
  @RequiresPermission('invoicing.read')
  get(@Param('marcheId') marcheId: string) {
    return this.dgd.get(marcheId);
  }
}
