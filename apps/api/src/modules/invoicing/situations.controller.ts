import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { SituationInput, SituationsService } from './situations.service';

@Controller()
export class SituationsController {
  constructor(private readonly situations: SituationsService) {}

  @Post('marches/:marcheId/situations')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.write')
  create(@Param('marcheId') marcheId: string, @Body() body: SituationInput) {
    if (!Array.isArray(body?.lines)) {
      throw new BadRequestException('lines[] is required');
    }
    return this.situations.createSituation(marcheId, body);
  }

  @Get('marches/:marcheId/situations')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  list(@Param('marcheId') marcheId: string) {
    return this.situations.listSituations(marcheId);
  }

  @Get('situations/:situationId')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  get(@Param('situationId') situationId: string) {
    return this.situations.getSituation(situationId);
  }
}
