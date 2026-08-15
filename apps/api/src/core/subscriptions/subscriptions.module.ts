import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SubscriptionService } from './subscription.service';
import { PackSubscriptionService } from './pack-subscription.service';
import { SubscriptionController } from './subscription.controller';

/**
 * Subscription lifecycle (two entry doors: trial / direct, expiry, paid modules). Projects
 * subscription state onto the enforcement tables consumed by the capability guard.
 */
@Module({
  imports: [TenancyModule, PricingModule],
  providers: [SubscriptionService, PackSubscriptionService],
  controllers: [SubscriptionController],
  exports: [SubscriptionService, PackSubscriptionService],
})
export class SubscriptionsModule {}
