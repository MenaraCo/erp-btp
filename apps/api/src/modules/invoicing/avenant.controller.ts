import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { AvenantInput, AvenantService } from './avenant.service';

@Controller()
export class AvenantController {
  constructor(private readonly avenants: AvenantService) {}

  @Post('marches/:marcheId/avenants')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.write')
  create(@Param('marcheId') marcheId: string, @Body() body: AvenantInput) {
    if (!Array.isArray(body?.lines) || body.lines.length === 0) {
      throw new BadRequestException('lines[] is required');
    }
    return this.avenants.createAvenant(marcheId, body);
  }

  @Get('marches/:marcheId/avenants')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  list(@Param('marcheId') marcheId: string) {
    return this.avenants.listAvenants(marcheId);
  }

  @Get('avenants/:avenantId')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  get(@Param('avenantId') avenantId: string) {
    return this.avenants.getAvenant(avenantId);
  }
}
