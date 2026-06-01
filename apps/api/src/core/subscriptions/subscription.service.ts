import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { runInTenant } from '../tenancy/tenant-transaction';
import {
  TRIAL_DAYS,
  TRIAL_QUOTAS,
  TRIAL_SEATS_PER_MODULE,
  SubscriptionStatus,
} from './subscription.config';

export interface SubscriptionRow {
  id: string;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

/**
 * Subscription lifecycle. The source of truth is subscription / module_subscription; every
 * change is projected onto the enforcement tables (tenant_module, tenant_quota) so the
 * capability guard keeps a stable contract. Data is never deleted — on expiry, modules go
 * read-only (cahier des charges §3.3/§3.4).
 */
@Injectable()
export class SubscriptionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  getSubscription(tenantId: string): Promise<SubscriptionRow | null> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT id, status, trial_ends_at, current_period_end
           FROM subscription WHERE tenant_id = $1`,
        [tenantId],
      );
      if (rows.length === 0) {
        return null;
      }
      const r = rows[0];
      return {
        id: r.id,
        status: r.status,
        trialEndsAt: r.trial_ends_at,
        currentPeriodEnd: r.current_period_end,
      };
    });
  }

  /** Starts the 30-day trial: subscription `trialing`, all modules active with bounded seats. */
  startTrial(tenantId: string): Promise<void> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const existing = await em.query(
        `SELECT id FROM subscription WHERE tenant_id = $1`,
        [tenantId],
      );
      if (existing.length > 0) {
        throw new ConflictException('A subscription already exists for this tenant');
      }

      const sub = await em.query(
        `INSERT INTO subscription (tenant_id, status, trial_ends_at)
         VALUES ($1, 'trialing', now() + ($2 || ' days')::interval)
         RETURNING id`,
        [tenantId, String(TRIAL_DAYS)],
      );
      const subscriptionId = sub[0].id;

      const modules = await em.query(
        `SELECT code FROM module WHERE active = true`,
      );
      for (const m of modules) {
        await em.query(
          `INSERT INTO module_subscription
             (tenant_id, subscription_id, module_code, seats_purchased, billing_period)
           VALUES ($1, $2, $3, $4, 'trial')`,
          [tenantId, subscriptionId, m.code, TRIAL_SEATS_PER_MODULE],
        );
        await this.upsertTenantModule(
          em,
          tenantId,
          m.code,
          TRIAL_SEATS_PER_MODULE,
          true,
        );
      }

      for (const [metric, limit] of Object.entries(TRIAL_QUOTAS)) {
        await em.query(
          `INSERT INTO tenant_quota (tenant_id, metric_key, limit_value)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, metric_key) DO UPDATE SET limit_value = EXCLUDED.limit_value`,
          [tenantId, metric, limit],
        );
      }
    });
  }

  /**
   * If the trial has lapsed without conversion: mark the subscription past_due and put every
   * module into read-only (active = false). No data is deleted. Idempotent.
   */
  applyExpiryIfDue(tenantId: string): Promise<{ changed: boolean }> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT id, status, trial_ends_at FROM subscription WHERE tenant_id = $1`,
        [tenantId],
      );
      if (rows.length === 0) {
        return { changed: false };
      }
      const sub = rows[0];
      const expired =
        sub.status === 'trialing' &&
        sub.trial_ends_at !== null &&
        new Date(sub.trial_ends_at).getTime() < Date.now();
      if (!expired) {
        return { changed: false };
      }
      await em.query(
        `UPDATE subscription SET status = 'past_due', updated_at = now() WHERE id = $1`,
        [sub.id],
      );
      await em.query(
        `UPDATE module_subscription SET read_only = true, updated_at = now() WHERE subscription_id = $1`,
        [sub.id],
      );
      await em.query(
        `UPDATE tenant_module SET active = false, read_only = true, updated_at = now() WHERE tenant_id = $1`,
        [tenantId],
      );
      return { changed: true };
    });
  }

  /** Adds/activates a paid module immediately (effet immédiat, cahier §3.4). */
  subscribeModule(
    tenantId: string,
    moduleCode: string,
    seats: number,
  ): Promise<void> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const sub = await em.query(
        `SELECT id FROM subscription WHERE tenant_id = $1`,
        [tenantId],
      );
      if (sub.length === 0) {
        throw new BadRequestException(
          'No subscription for this tenant — start a trial first',
        );
      }
      const subscriptionId = sub[0].id;
      await em.query(
        `UPDATE subscription SET status = 'active', updated_at = now() WHERE id = $1`,
        [subscriptionId],
      );
      await em.query(
        `INSERT INTO module_subscription
           (tenant_id, subscription_id, module_code, seats_purchased, billing_period, read_only)
         VALUES ($1, $2, $3, $4, 'monthly', false)
         ON CONFLICT (subscription_id, module_code)
         DO UPDATE SET seats_purchased = EXCLUDED.seats_purchased, read_only = false, updated_at = now()`,
        [tenantId, subscriptionId, moduleCode, seats],
      );
      await this.upsertTenantModule(em, tenantId, moduleCode, seats, true);
    });
  }

  private async upsertTenantModule(
    em: EntityManager,
    tenantId: string,
    moduleCode: string,
    seats: number,
    active: boolean,
  ): Promise<void> {
    await em.query(
      `INSERT INTO tenant_module (tenant_id, module_code, seats_purchased, active, read_only)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (tenant_id, module_code)
       DO UPDATE SET seats_purchased = EXCLUDED.seats_purchased, active = EXCLUDED.active,
                     read_only = false, updated_at = now()`,
      [tenantId, moduleCode, seats, active],
    );
  }
}
