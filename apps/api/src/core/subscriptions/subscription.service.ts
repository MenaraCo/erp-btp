import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PricingService } from '../pricing/pricing.service';
import { runInTenant } from '../tenancy/tenant-transaction';
import { returningRows } from '../database/returning.util';
import {
  TRIAL_QUOTAS,
  TRIAL_SEATS_PER_MODULE,
  SubscriptionStatus,
} from './subscription.config';

export interface SubscriptionRow {
  id: string;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface SubscribedModuleRow {
  moduleCode: string;
  seatsPurchased: number;
  seatsAssigned: number;
  active: boolean;
  readOnly: boolean;
}

/**
 * Subscription lifecycle. The source of truth is subscription / module_subscription; every
 * change is projected onto the enforcement tables (tenant_module, tenant_quota) so the
 * capability guard keeps a stable contract. Data is never deleted — on expiry, modules go
 * read-only (cahier des charges §3.3/§3.4).
 */
@Injectable()
export class SubscriptionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly pricing: PricingService,
  ) {}

  getSubscription(tenantId: string): Promise<SubscriptionRow | null> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT id, status, trial_ends_at, current_period_end, cancel_at_period_end
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
        cancelAtPeriodEnd: r.cancel_at_period_end,
      };
    });
  }

  /**
   * Subscribed modules for the console: purchased seats vs. assigned seats (jetons) per module,
   * plus active / read-only state. Left-joins the seat count so a module with zero assignments
   * still appears.
   */
  getSubscribedModules(tenantId: string): Promise<SubscribedModuleRow[]> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT tm.module_code,
                tm.seats_purchased,
                tm.active,
                tm.read_only,
                COALESCE(sa.n, 0) AS seats_assigned
           FROM tenant_module tm
           LEFT JOIN (
             SELECT module_code, count(*)::int AS n
               FROM seat_assignment
              GROUP BY module_code
           ) sa ON sa.module_code = tm.module_code
          ORDER BY tm.module_code`,
      );
      return rows.map(
        (r: {
          module_code: string;
          seats_purchased: number;
          active: boolean;
          read_only: boolean;
          seats_assigned: number;
        }) => ({
          moduleCode: r.module_code,
          seatsPurchased: Number(r.seats_purchased),
          seatsAssigned: Number(r.seats_assigned),
          active: r.active,
          readOnly: r.read_only,
        }),
      );
    });
  }

  /**
   * Résiliation (cahier §3.4): flags the subscription to cancel at the end of the current period.
   * Access is preserved until current_period_end; no data is deleted. Idempotent; pass
   * `cancel = false` to revoke a pending cancellation.
   */
  setCancelAtPeriodEnd(
    tenantId: string,
    cancel: boolean,
  ): Promise<SubscriptionRow | null> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const updated = returningRows<{
        id: string;
        status: SubscriptionStatus;
        trial_ends_at: Date | null;
        current_period_end: Date | null;
        cancel_at_period_end: boolean;
      }>(
        await em.query(
          `UPDATE subscription SET cancel_at_period_end = $1, updated_at = now()
          WHERE tenant_id = $2
          RETURNING id, status, trial_ends_at, current_period_end, cancel_at_period_end`,
          [cancel, tenantId],
        ),
      );
      if (updated.length === 0) {
        throw new BadRequestException('No subscription for this tenant');
      }
      const r = updated[0];
      return {
        id: r.id,
        status: r.status,
        trialEndsAt: r.trial_ends_at,
        currentPeriodEnd: r.current_period_end,
        cancelAtPeriodEnd: r.cancel_at_period_end,
      };
    });
  }

  /**
   * Démarre l'essai gratuit : souscription `trialing`, tous les modules ouverts avec un nombre de
   * jetons borné. La DURÉE est un réglage de l'éditeur (30 jours par défaut) : on la lit à chaque
   * démarrage, pour qu'une campagne plus généreuse s'applique sans redéploiement.
   */
  async startTrial(tenantId: string): Promise<void> {
    const trialDays = await this.pricing.getTrialDays();
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
        [tenantId, String(trialDays)],
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

  /**
   * Porte 2 (cahier §3.3): direct subscription WITHOUT a trial — for the chosen modules, never
   * through `trialing`.
   *
   * `statutInitial` vaut `incomplete` quand la souscription naît d'une INSCRIPTION : les modules
   * sont retenus mais fermés jusqu'au premier paiement, sinon créer un compte suffirait à
   * obtenir un abonnement payant sans payer. Les souscriptions ouvertes depuis l'application par
   * un client déjà connu restent en `active`.
   */
  subscribeDirect(
    tenantId: string,
    modules: Array<{ moduleCode: string; seats: number }>,
    statutInitial: 'active' | 'incomplete' = 'active',
  ): Promise<void> {
    if (!modules || modules.length === 0) {
      throw new BadRequestException('At least one module is required');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const existing = await em.query(
        `SELECT id FROM subscription WHERE tenant_id = $1`,
        [tenantId],
      );
      if (existing.length > 0) {
        throw new ConflictException('A subscription already exists for this tenant');
      }

      const sub = await em.query(
        `INSERT INTO subscription (tenant_id, status) VALUES ($1, $2) RETURNING id`,
        [tenantId, statutInitial],
      );
      const subscriptionId = sub[0].id;
      const ouvert = statutInitial === 'active';

      for (const m of modules) {
        await em.query(
          `INSERT INTO module_subscription
             (tenant_id, subscription_id, module_code, seats_purchased, billing_period)
           VALUES ($1, $2, $3, $4, 'monthly')`,
          [tenantId, subscriptionId, m.moduleCode, m.seats],
        );
        // Les modules ne s'ouvrent qu'une fois le paiement encaissé.
        await this.upsertTenantModule(em, tenantId, m.moduleCode, m.seats, ouvert);
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
