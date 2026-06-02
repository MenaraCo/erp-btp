import { Controller, Get, Param } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { AnalyticsService } from './analytics.service';

@Controller('chantiers/:chantierId')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('results')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  results(@Param('chantierId') chantierId: string) {
    return this.analytics.chantierResults(chantierId);
  }

  @Get('accounting-export')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  accountingExport(@Param('chantierId') chantierId: string) {
    return this.analytics.accountingExport(chantierId);
  }
}
