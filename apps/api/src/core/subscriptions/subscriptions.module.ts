import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SubscriptionService } from './subscription.service';

/**
 * Subscription lifecycle (trial, expiry, paid modules). Projects subscription state onto the
 * enforcement tables consumed by the capability guard.
 */
@Module({
  imports: [TenancyModule],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionsModule {}
