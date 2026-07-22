import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SubscriptionService } from './subscription.service';
import { PackSubscriptionService } from './pack-subscription.service';
import { SubscriptionController } from './subscription.controller';

/**
 * Subscription lifecycle (two entry doors: trial / direct, expiry, paid modules). Projects
 * subscription state onto the enforcement tables consumed by the capability guard.
 */
@Module({
  imports: [TenancyModule],
  providers: [SubscriptionService, PackSubscriptionService],
  controllers: [SubscriptionController],
  exports: [SubscriptionService, PackSubscriptionService],
})
export class SubscriptionsModule {}
