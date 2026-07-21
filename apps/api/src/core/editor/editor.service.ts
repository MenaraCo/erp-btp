import { Injectable } from '@nestjs/common';
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

      rows.push({
        tenantId: t.id,
        slug: t.slug,
        name: t.name,
        createdAt: t.created_at,
        ...row,
      });
    }
    return rows;
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
