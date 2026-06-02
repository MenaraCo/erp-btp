import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { WorkflowService } from './workflow.service';

@Controller('affaires/:affaireId')
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Post('transition')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  transition(@Param('affaireId') affaireId: string, @Body() body: { to?: string }) {
    if (!body?.to) {
      throw new BadRequestException('to (target status) is required');
    }
    return this.workflow.transition(affaireId, body.to);
  }

  @Get('transfer-check')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  transferCheck(@Param('affaireId') affaireId: string) {
    return this.workflow.transferCheck(affaireId);
  }
}
