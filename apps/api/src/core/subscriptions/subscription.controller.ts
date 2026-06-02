import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { RequiresPermission } from '../rbac/requires-permission.decorator';
import { TenantContext } from '../tenancy/tenant-context';
import { SubscriptionService } from './subscription.service';

interface DirectInput {
  modules?: Array<{ moduleCode: string; seats: number }>;
}

/**
 * Subscription management — two independent entry doors (cahier §3.3):
 * POST /subscription/trial (Porte 1, trialing) and POST /subscription/direct (Porte 2, active).
 * Core admin action, gated by RBAC only (not a licensed module capability).
 */
@Controller('subscription')
export class SubscriptionController {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly context: TenantContext,
  ) {}

  @Get()
  @RequiresPermission('subscription.manage')
  get() {
    return this.subscriptions.getSubscription(this.context.requireTenantId());
  }

  @Post('trial')
  @RequiresPermission('subscription.manage')
  async startTrial() {
    const tenantId = this.context.requireTenantId();
    await this.subscriptions.startTrial(tenantId);
    return this.subscriptions.getSubscription(tenantId);
  }

  @Post('direct')
  @RequiresPermission('subscription.manage')
  async subscribeDirect(@Body() body: DirectInput) {
    if (!Array.isArray(body?.modules) || body.modules.length === 0) {
      throw new BadRequestException('modules[] is required');
    }
    const tenantId = this.context.requireTenantId();
    await this.subscriptions.subscribeDirect(tenantId, body.modules);
    return this.subscriptions.getSubscription(tenantId);
  }
}
