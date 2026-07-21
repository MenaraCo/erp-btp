import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runInTenant } from '../tenancy/tenant-transaction';
import { MODULES } from '../catalog/catalog.config';

export interface EditorTenantRow {
  tenantId: string;
  slug: string;
  name: string;
  createdAt: Date;
  status: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  activeModules: string[];
  seatsPurchased: number;
  seatsAssigned: number;
  mrr: number;
}

export interface EditorOverview {
  tenants: number;
  trialing: number;
  active: number;
  pastDue: number;
  canceled: number;
  paused: number;
  mrr: number;
  arr: number;
  trialsEndingSoon: number;
  conversionRate: number;
}

const PRICE_BY_MODULE = new Map(MODULES.map((m) => [m.code, m.priceMonthly ?? 0]));

/**
 * Editor back-office data (cahier §3.7 B): a cross-tenant view of every subscriber. The app role
 * is RLS-forced, so we read the global `tenant` table (no RLS) then read each tenant's data inside
 * its own tenant context (runInTenant). This reuses the RLS-safe path with no privileged
 * connection; fine at early scale, optimisable with an owner-role read model later. MRR is derived
 * from the config-driven module prices — never hard-coded.
 */
@Injectable()
export class EditorService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getTenants(): Promise<EditorTenantRow[]> {
    const tenants: Array<{ id: string; slug: string; name: string; created_at: Date }> =
      await this.dataSource.query(
        `SELECT id, slug, name, created_at FROM tenant ORDER BY created_at DESC`,
      );

    const rows: EditorTenantRow[] = [];
    for (const t of tenants) {
      rows.push(await this.readTenantRow(t));
    }
    return rows;
  }

  /** Reads one tenant's subscription snapshot inside its own tenant context (RLS-scoped). */
  private async readTenantRow(t: {
    id: string;
    slug: string;
    name: string;
    created_at: Date;
  }): Promise<EditorTenantRow> {
    const row = await runInTenant(this.dataSource, t.id, async (em) => {
      const subRows = await em.query(
        `SELECT status, trial_ends_at, current_period_end, cancel_at_period_end
           FROM subscription WHERE tenant_id = $1`,
        [t.id],
      );
      const sub = subRows[0] ?? null;

      const modules: Array<{
        module_code: string;
        seats_purchased: number;
        active: boolean;
      }> = await em.query(
        `SELECT module_code, seats_purchased, active FROM tenant_module`,
      );
      const assigned = await em.query(
        `SELECT count(*)::int AS n FROM seat_assignment`,
      );

      const activeModules = modules.filter((m) => m.active).map((m) => m.module_code);
      const seatsPurchased = modules
        .filter((m) => m.active)
        .reduce((s, m) => s + Number(m.seats_purchased), 0);
      // MRR: only paying (active) subscriptions contribute; trials count as 0.
      const mrr =
        sub?.status === 'active'
          ? modules
              .filter((m) => m.active)
              .reduce(
                (s, m) => s + Number(m.seats_purchased) * (PRICE_BY_MODULE.get(m.module_code) ?? 0),
                0,
              )
          : 0;

      return {
        status: sub?.status ?? null,
        trialEndsAt: sub?.trial_ends_at ?? null,
        currentPeriodEnd: sub?.current_period_end ?? null,
        cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
        activeModules,
        seatsPurchased,
        seatsAssigned: Number(assigned[0]?.n ?? 0),
        mrr,
      };
    });

    return {
      tenantId: t.id,
      slug: t.slug,
      name: t.name,
      createdAt: t.created_at,
      ...row,
    };
  }

  private async tenantBase(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT id, slug, name, created_at FROM tenant WHERE id = $1`,
      [tenantId],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Tenant introuvable');
    }
    return rows[0] as { id: string; slug: string; name: string; created_at: Date };
  }

  /**
   * Support action (cahier §3.7 B): extends a tenant's trial by `days`. Puts the subscription back
   * to `trialing`, pushes trial_ends_at from max(now, current), and re-opens modules that expiry
   * may have set read-only. Never deletes data.
   */
  async extendTrial(tenantId: string, days: number): Promise<EditorTenantRow> {
    const d = Math.trunc(days);
    if (!Number.isFinite(d) || d <= 0 || d > 365) {
      throw new BadRequestException('days doit être un entier entre 1 et 365');
    }
    const base = await this.tenantBase(tenantId);
    await runInTenant(this.dataSource, tenantId, async (em) => {
      const updated = await em.query(
        `UPDATE subscription
            SET status = 'trialing',
                trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + ($2 || ' days')::interval,
                updated_at = now()
          WHERE tenant_id = $1
          RETURNING id`,
        [tenantId, String(d)],
      );
      if (updated.length === 0) {
        throw new BadRequestException('Aucune souscription pour ce tenant');
      }
      await em.query(
        `UPDATE tenant_module SET active = true, read_only = false, updated_at = now() WHERE tenant_id = $1`,
        [tenantId],
      );
      await em.query(
        `UPDATE module_subscription SET read_only = false, updated_at = now() WHERE tenant_id = $1`,
        [tenantId],
      );
    });
    return this.readTenantRow(base);
  }

  /**
   * Support action (cahier §3.7 B): forces a subscription to `active` (offline payment / commercial
   * gesture), clears any pending cancellation, and re-opens all modules. No payment is taken here —
   * this is an editor override, tracked by the status change.
   */
  async forceActivate(tenantId: string): Promise<EditorTenantRow> {
    const base = await this.tenantBase(tenantId);
    await runInTenant(this.dataSource, tenantId, async (em) => {
      const updated = await em.query(
        `UPDATE subscription
            SET status = 'active', cancel_at_period_end = false, updated_at = now()
          WHERE tenant_id = $1
          RETURNING id`,
        [tenantId],
      );
      if (updated.length === 0) {
        throw new BadRequestException('Aucune souscription pour ce tenant');
      }
      await em.query(
        `UPDATE tenant_module SET active = true, read_only = false, updated_at = now() WHERE tenant_id = $1`,
        [tenantId],
      );
      await em.query(
        `UPDATE module_subscription SET read_only = false, updated_at = now() WHERE tenant_id = $1`,
        [tenantId],
      );
    });
    return this.readTenantRow(base);
  }

  async getOverview(): Promise<EditorOverview> {
    const rows = await this.getTenants();
    const now = Date.now();
    const soon = now + 7 * 86_400_000;

    const count = (status: string) => rows.filter((r) => r.status === status).length;
    const trialing = count('trialing');
    const active = count('active');
    const mrr = rows.reduce((s, r) => s + r.mrr, 0);
    const trialsEndingSoon = rows.filter(
      (r) =>
        r.status === 'trialing' &&
        r.trialEndsAt &&
        new Date(r.trialEndsAt).getTime() <= soon &&
        new Date(r.trialEndsAt).getTime() >= now,
    ).length;
    // Rough conversion: paying over (paying + trialing) — a simple funnel indicator.
    const conversionRate = active + trialing > 0 ? active / (active + trialing) : 0;

    return {
      tenants: rows.length,
      trialing,
      active,
      pastDue: count('past_due'),
      canceled: count('canceled'),
      paused: count('paused'),
      mrr,
      arr: mrr * 12,
      trialsEndingSoon,
      conversionRate,
    };
  }
}
