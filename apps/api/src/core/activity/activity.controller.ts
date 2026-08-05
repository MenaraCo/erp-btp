import { Controller, Get, Query } from '@nestjs/common';
import { RequiresCapability } from '../entitlements/requires-capability.decorator';
import { RequiresPermission } from '../rbac/requires-permission.decorator';
import { ActivityService } from './activity.service';

/**
 * Historique des modifications. Le fil raconte aujourd'hui la vie des affaires et des devis :
 * il est donc gardé comme la lecture d'un devis — même capacité, même permission.
 */
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  list(@Query('limit') limit?: string) {
    return this.activity.list(limit ? Number(limit) : 20);
  }
}
