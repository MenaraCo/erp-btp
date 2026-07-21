import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runInTenant } from '../tenancy/tenant-transaction';
import { MODULES } from '../catalog/catalog.config';
import { CatalogService } from '../catalog/catalog.service';

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
  moduleDetails: Array<{ code: string; seats: number; active: boolean }>;
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

const MODULE_CODES = new Set(MODULES.map((m) => m.code));

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'canceled';
const ALL_STATUSES: SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'paused',
  'canceled',
];
/** Statuses that grant module access; the rest close modules to read-only. */
const OPEN_STATUSES: SubscriptionStatus[] = ['active', 'trialing'];

/**
 * Editor back-office data (cahier §3.7 B): a cross-tenant view of every subscriber. The app role
 * is RLS-forced, so we read the global `tenant` table (no RLS) then read each tenant's data inside
 * its own tenant context (runInTenant). This reuses the RLS-safe path with no privileged
 * connection; fine at early scale, optimisable with an owner-role read model later. MRR is derived
 * from the module prices stored in the database (editable from this back-office) — never hard-coded.
 */
@Injectable()
export class EditorService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly catalog: CatalogService,
  ) {}

  async getTenants(): Promise<EditorTenantRow[]> {
    const tenants: Array<{ id: string; slug: string; name: string; created_at: Date }> =
      await this.dataSource.query(
        `SELECT id, slug, name, created_at FROM tenant ORDER BY created_at DESC`,
      );

    // Load prices once for the whole listing.
    const prices = await this.catalog.getPriceByModuleCode();
    const rows: EditorTenantRow[] = [];
    for (const t of tenants) {
      rows.push(await this.readTenantRow(t, prices));
    }
    return rows;
  }

  /** Reads one tenant's subscription snapshot inside its own tenant context (RLS-scoped). */
  private async readTenantRow(
    t: {
      id: string;
      slug: string;
      name: string;
      created_at: Date;
    },
    priceByModule?: Map<string, number>,
  ): Promise<EditorTenantRow> {
    const prices = priceByModule ?? (await this.catalog.getPriceByModuleCode());
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
                (s, m) => s + Number(m.seats_purchased) * (prices.get(m.module_code) ?? 0),
                0,
              )
          : 0;

      return {
        status: sub?.status ?? null,
        trialEndsAt: sub?.trial_ends_at ?? null,
        currentPeriodEnd: sub?.current_period_end ?? null,
        cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
        activeModules,
        moduleDetails: modules
          .map((m) => ({ code: m.module_code, seats: Number(m.seats_purchased), active: m.active }))
          .sort((a, b) => a.code.localeCompare(b.code)),
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

  /** Force a subscription to `active` (offline payment / commercial gesture). Thin wrapper. */
  forceActivate(tenantId: string): Promise<EditorTenantRow> {
    return this.setStatus(tenantId, 'active');
  }

  /**
   * Support action (cahier §3.7 B): moves a subscription to any lifecycle status and projects the
   * matching access onto the enforcement tables. Opening statuses (active/trialing) re-open the
   * modules; restricting statuses (paused/past_due/canceled) close them to read-only — data is
   * never deleted. `trialDays` (re)sets the trial window when moving to `trialing`.
   */
  async setStatus(
    tenantId: string,
    status: SubscriptionStatus,
    trialDays?: number,
  ): Promise<EditorTenantRow> {
    if (!ALL_STATUSES.includes(status)) {
      throw new BadRequestException(`Statut invalide: ${status}`);
    }
    const base = await this.tenantBase(tenantId);
    const open = OPEN_STATUSES.includes(status);
    await runInTenant(this.dataSource, tenantId, async (em) => {
      const setTrial =
        status === 'trialing' && trialDays && trialDays > 0
          ? `, trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + ('${Math.trunc(
              trialDays,
            )} days')::interval`
          : '';
      const clearCancel = status === 'active' ? ', cancel_at_period_end = false' : '';
      const updated = await em.query(
        `UPDATE subscription
            SET status = $2, updated_at = now()${clearCancel}${setTrial}
          WHERE tenant_id = $1
          RETURNING id`,
        [tenantId, status],
      );
      if (updated.length === 0) {
        throw new BadRequestException('Aucune souscription pour ce tenant');
      }
      await this.applyModuleAccess(em, tenantId, open);
    });
    return this.readTenantRow(base);
  }

  /** Programs (or revokes) cancellation at the end of the current period. */
  async setCancelAtPeriodEnd(tenantId: string, cancel: boolean): Promise<EditorTenantRow> {
    const base = await this.tenantBase(tenantId);
    await runInTenant(this.dataSource, tenantId, async (em) => {
      const updated = await em.query(
        `UPDATE subscription SET cancel_at_period_end = $2, updated_at = now()
          WHERE tenant_id = $1 RETURNING id`,
        [tenantId, cancel],
      );
      if (updated.length === 0) {
        throw new BadRequestException('Aucune souscription pour ce tenant');
      }
    });
    return this.readTenantRow(base);
  }

  /** Sets the end of the current billing period (échéance). Pass an ISO date string. */
  async setPeriodEnd(tenantId: string, dateIso: string): Promise<EditorTenantRow> {
    const d = new Date(dateIso);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Date invalide');
    }
    const base = await this.tenantBase(tenantId);
    await runInTenant(this.dataSource, tenantId, async (em) => {
      const updated = await em.query(
        `UPDATE subscription SET current_period_end = $2, updated_at = now()
          WHERE tenant_id = $1 RETURNING id`,
        [tenantId, d.toISOString()],
      );
      if (updated.length === 0) {
        throw new BadRequestException('Aucune souscription pour ce tenant');
      }
    });
    return this.readTenantRow(base);
  }

  /**
   * Adds/adjusts a module for the tenant (seats > 0 → active with that many seats) or deactivates
   * it (seats = 0 → read-only, never removed). Core (Socle) cannot be deactivated. Projects onto
   * both the source (module_subscription) and the enforcement table (tenant_module).
   */
  async setModule(
    tenantId: string,
    moduleCode: string,
    seats: number,
  ): Promise<EditorTenantRow> {
    if (!MODULE_CODES.has(moduleCode)) {
      throw new BadRequestException(`Module inconnu: ${moduleCode}`);
    }
    const s = Math.trunc(Number(seats));
    if (!Number.isFinite(s) || s < 0) {
      throw new BadRequestException('Nombre de jetons invalide');
    }
    if (moduleCode === 'core' && s === 0) {
      throw new BadRequestException('Le Socle ne peut pas être désactivé');
    }
    const base = await this.tenantBase(tenantId);
    await runInTenant(this.dataSource, tenantId, async (em) => {
      const subRows = await em.query(
        `SELECT id FROM subscription WHERE tenant_id = $1`,
        [tenantId],
      );
      if (subRows.length === 0) {
        throw new BadRequestException('Aucune souscription pour ce tenant');
      }
      const subscriptionId = subRows[0].id;
      const active = s > 0;

      await em.query(
        `INSERT INTO tenant_module (tenant_id, module_code, seats_purchased, active, read_only)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, module_code)
         DO UPDATE SET seats_purchased = EXCLUDED.seats_purchased, active = EXCLUDED.active,
                       read_only = EXCLUDED.read_only, updated_at = now()`,
        [tenantId, moduleCode, s, active, !active],
      );
      await em.query(
        `INSERT INTO module_subscription
           (tenant_id, subscription_id, module_code, seats_purchased, billing_period, read_only)
         VALUES ($1, $2, $3, $4, 'monthly', $5)
         ON CONFLICT (subscription_id, module_code)
         DO UPDATE SET seats_purchased = EXCLUDED.seats_purchased, read_only = EXCLUDED.read_only,
                       updated_at = now()`,
        [tenantId, subscriptionId, moduleCode, s, !active],
      );
    });
    return this.readTenantRow(base);
  }

  /** Commercial catalogue (prices from the database, editable here). */
  getCatalog() {
    return this.catalog.getCatalogModules();
  }

  /**
   * Editor pricing control (cahier §3.2/§3.7 B): changes a module's price/label/active state.
   * Takes effect immediately for quotes, the client console and MRR — no redeployment.
   */
  async updateCatalogModule(
    code: string,
    patch: { priceMonthly?: number | null; label?: string; active?: boolean },
  ) {
    if (!MODULE_CODES.has(code)) {
      throw new BadRequestException(`Module inconnu: ${code}`);
    }
    if (patch.priceMonthly !== undefined && patch.priceMonthly !== null) {
      const p = Number(patch.priceMonthly);
      if (!Number.isFinite(p) || p < 0) {
        throw new BadRequestException('Prix invalide (doit être ≥ 0, ou null pour « sur devis »)');
      }
      patch.priceMonthly = Math.round(p * 100) / 100;
    }
    if (patch.label !== undefined && !patch.label.trim()) {
      throw new BadRequestException('Le libellé ne peut pas être vide');
    }
    const updated = await this.catalog.updateModule(code, patch);
    if (!updated) {
      throw new NotFoundException(`Module ${code} introuvable`);
    }
    return updated;
  }

  /** Opens (active=true) or restricts (active=false, read-only) every module of the tenant. */
  private async applyModuleAccess(
    em: import('typeorm').EntityManager,
    tenantId: string,
    open: boolean,
  ): Promise<void> {
    await em.query(
      `UPDATE tenant_module SET active = $2, read_only = $3, updated_at = now() WHERE tenant_id = $1`,
      [tenantId, open, !open],
    );
    await em.query(
      `UPDATE module_subscription SET read_only = $2, updated_at = now() WHERE tenant_id = $1`,
      [tenantId, !open],
    );
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
