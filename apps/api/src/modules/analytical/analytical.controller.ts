import { Body, Controller, Get, Post } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import {
  AnalyticalPlanService,
  FamilleInput,
  LotInput,
} from './analytical-plan.service';

/**
 * Plan analytique endpoints (cahier des charges §5.8). The plan is reference data tied to the
 * estimating resources (a resource IS the analytical code), so it is gated under the estimating
 * module capability and the estimating read/write permissions.
 */
@Controller('analytical')
export class AnalyticalController {
  constructor(private readonly plan: AnalyticalPlanService) {}

  @Get('plan')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  async getPlan() {
    await this.plan.ensurePlan();
    return this.plan.getTree();
  }

  @Post('lots')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  createLot(@Body() body: LotInput) {
    return this.plan.createLot(body);
  }

  @Post('familles')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  createFamille(@Body() body: FamilleInput) {
    return this.plan.createFamille(body);
  }
}
