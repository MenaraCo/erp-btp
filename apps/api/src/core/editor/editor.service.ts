import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runInTenant } from '../tenancy/tenant-transaction';
import { returningRows } from '../database/returning.util';
import { MODULES } from '../catalog/catalog.config';
import { CatalogService } from '../catalog/catalog.service';
import {
  PromoCodeService,
  type PromoCode,
  type PromoCodeInput,
} from '../promo/promo-code.service';
import { PricingService } from '../pricing/pricing.service';
import {
  computePricing,
  type BillingInterval,
  type BillingTerm,
} from '../pricing/pricing.calc';

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
  /** MRR après remises (engagement puis promo) — ce qui est réellement facturé. */
  mrr: number;
  /** MRR au tarif catalogue, avant toute remise. */
  mrrGross: number;
  promoCode: { code: string; discountType: string; discountValue: number } | null;
  /** Formule : engagement et rythme de facturation. */
  billingTerm: BillingTerm;
  billingInterval: BillingInterval;
  commitmentEndsAt: Date | null;
  /** Remise d'engagement appliquée (%) et montant de chaque facture. */
  termDiscountPct: number;
  amountPerInvoice: number;
  /** Palier souscrit et ses jetons (offre par paliers). */
  packCode: string | null;
  packSeats: number;
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
  private readonly logger = new Logger(EditorService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly catalog: CatalogService,
    private readonly promos: PromoCodeService,
    private readonly pricing: PricingService,
  ) {}


  /* ================== FICHE D'UN ABONNÉ ================== */

  /**
   * Tout ce que l'éditeur sait d'une société abonnée : son identité administrative, ses contacts,
   * son abonnement, et le VOLUME de ce qu'elle a produit.
   *
   * Le volume n'est pas décoratif : c'est lui qui dit ce qu'une suppression détruirait. Supprimer
   * un compte d'essai vide et supprimer un client qui a deux ans de chantiers ne se décident pas
   * de la même façon.
   */
  async getTenantDetail(tenantId: string) {
    const [t] = await this.dataSource.query(
      `SELECT id, slug, name, status, created_at FROM tenant WHERE id = $1`,
      [tenantId],
    );
    if (!t) throw new NotFoundException(`Société introuvable (${tenantId}).`);

    return runInTenant(this.dataSource, tenantId, async (em) => {
      // Identité(s) administrative(s) — une société peut en porter plusieurs (multi-société).
      const societes = await em.query(
        `SELECT code, name, legal_form, siren, siret, vat_intra, rcs, capital,
                address, postal_code, city, phone, email
           FROM company ORDER BY created_at ASC`,
      );

      // Contacts : les comptes actifs, avec leurs rôles — l'administrateur d'abord.
      const contacts = await em.query(
        `SELECT u.email, u.full_name, u.status, u.created_at, u.mfa_enabled,
                COALESCE(ARRAY_AGG(r.label ORDER BY r.label) FILTER (WHERE r.label IS NOT NULL), '{}') AS roles
           FROM user_account u
           LEFT JOIN user_role ur ON ur.user_id = u.id
           LEFT JOIN role r ON r.id = ur.role_id
          WHERE u.deleted_at IS NULL
          GROUP BY u.id, u.email, u.full_name, u.status, u.created_at, u.mfa_enabled
          ORDER BY u.created_at ASC`,
      );

      const [abo] = await em.query(
        `SELECT status, trial_ends_at, current_period_end, cancel_at_period_end,
                billing_term, billing_interval, pack_code, pack_seats,
                provider_customer_id, provider_subscription_id
           FROM subscription WHERE tenant_id = $1`,
        [tenantId],
      );

      // Ce qu'une suppression emporterait.
      const volumes: Record<string, number> = {};
      for (const [cle, table] of [
        ['affaires', 'affaire'], ['devis', 'devis'], ['chantiers', 'chantier'],
        ['marches', 'marche'], ['clients', 'client'], ['fournisseurs', 'supplier'],
        ['ressources', 'resource'], ['utilisateurs', 'user_account'],
      ] as const) {
        const [r] = await em.query(`SELECT count(*)::int AS n FROM ${table}`);
        volumes[cle] = r.n;
      }

      return {
        tenant: { id: t.id, slug: t.slug, name: t.name, status: t.status, createdAt: t.created_at },
        societes,
        contacts,
        abonnement: abo ?? null,
        volumes,
      };
    });
  }

  /**
   * Supprime définitivement une société et TOUT ce qu'elle contient.
   *
   * 58 tables référencent `tenant` en cascade : affaires, devis, chantiers, factures, pointages,
   * pièces jointes — tout part. Il n'y a pas de corbeille et pas de retour en arrière.
   *
   * Deux garde-fous, parce qu'une erreur ici est irréparable :
   *  - le SLUG exact doit être retapé, ce qui interdit de supprimer par inadvertance en cliquant ;
   *  - une société dont l'abonnement est encore actif est refusée. Résilier d'abord force à
   *    regarder ce qu'on fait, et évite de détruire un client qui paie encore.
   */
  async deleteTenant(tenantId: string, confirmationSlug: string) {
    const [t] = await this.dataSource.query(
      `SELECT id, slug, name FROM tenant WHERE id = $1`,
      [tenantId],
    );
    if (!t) throw new NotFoundException(`Société introuvable (${tenantId}).`);

    if ((confirmationSlug ?? '').trim() !== t.slug) {
      throw new BadRequestException(
        `Confirmation incorrecte : retapez exactement « ${t.slug} » pour supprimer cette société.`,
      );
    }

    const [abo] = await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT status FROM subscription WHERE tenant_id = $1`, [tenantId]),
    );
    if (abo && abo.status === 'active') {
      throw new ConflictException(
        'Cette société a un abonnement ACTIF. Résiliez-le d’abord — on ne supprime pas un client qui paie.',
      );
    }

    // La cascade fait le reste : chaque table tenant-scopée porte ON DELETE CASCADE.
    await this.dataSource.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
    this.logger.warn(`Société supprimée définitivement : ${t.slug} (${t.name}).`);
    return { supprime: true, slug: t.slug };
  }

  async getTenants(): Promise<EditorTenantRow[]> {
    const tenants: Array<{ id: string; slug: string; name: string; created_at: Date }> =
      await this.dataSource.query(
        `SELECT id, slug, name, created_at FROM tenant ORDER BY created_at DESC`,
      );

    // Prix et taux de remise chargés une seule fois pour tout le listing.
    const prices = await this.catalog.getPriceByModuleCode();
    const annualDiscountPct = await this.pricing.getAnnualDiscountPct();
    const rows: EditorTenantRow[] = [];
    for (const t of tenants) {
      rows.push(await this.readTenantRow(t, prices, annualDiscountPct));
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
    annualDiscountPctArg?: number,
  ): Promise<EditorTenantRow> {
    const prices = priceByModule ?? (await this.catalog.getPriceByModuleCode());
    const annualDiscountPct =
      annualDiscountPctArg ?? (await this.pricing.getAnnualDiscountPct());
    const row = await runInTenant(this.dataSource, t.id, async (em) => {
      const subRows = await em.query(
        `SELECT status, trial_ends_at, current_period_end, cancel_at_period_end, promo_code_id,
                billing_term, billing_interval, commitment_ends_at, pack_code, pack_seats
           FROM subscription WHERE tenant_id = $1`,
        [t.id],
      );
      const sub = subRows[0] ?? null;
      const promo = sub?.promo_code_id
        ? await this.promos.findById(sub.promo_code_id)
        : null;

      // Tarification par paliers : le prix est celui du pack (× jetons du pack), auquel s'ajoutent
      // les options à la carte (× leurs propres jetons). On ne somme plus les modules du pack :
      // ils sont couverts par le palier.
      const packRow = sub?.pack_code
        ? (
            await em.query(`SELECT price_monthly FROM pack WHERE code = $1`, [sub.pack_code])
          )[0]
        : null;
      const paidAddons: Array<{ module_code: string; seats_purchased: number }> =
        await em.query(
          `SELECT ms.module_code, ms.seats_purchased
             FROM module_subscription ms
             JOIN module m ON m.code = ms.module_code
             JOIN tenant_module tm ON tm.module_code = ms.module_code AND tm.tenant_id = ms.tenant_id
            WHERE m.is_addon = true AND ms.seats_purchased > 0
              AND ms.billing_period <> 'trial' AND tm.active = true`,
        );

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
      // Seules les souscriptions payantes (active) contribuent ; les essais comptent 0.
      const billable = sub?.status === 'active';
      const billingTerm: BillingTerm = sub?.billing_term === 'annual' ? 'annual' : 'monthly';
      const billingInterval: BillingInterval =
        sub?.billing_interval === 'yearly' ? 'yearly' : 'monthly';

      // Cascade complète : palier + options → remise d'engagement → code promo.
      const packSeats = Number(sub?.pack_seats ?? 0);
      const packPrice = packRow?.price_monthly == null ? 0 : Number(packRow.price_monthly);
      const lines = billable
        ? [
            ...(sub?.pack_code ? [{ seats: packSeats, unitPrice: packPrice }] : []),
            ...paidAddons.map((a) => ({
              seats: Number(a.seats_purchased),
              unitPrice: prices.get(a.module_code) ?? 0,
            })),
          ]
        : [];
      const pricing = computePricing({
        lines,
        billingTerm,
        billingInterval,
        annualDiscountPct,
        promo,
      });

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
        mrr: pricing.mrr,
        mrrGross: pricing.monthlyBase,
        promoCode: promo
          ? {
              code: promo.code,
              discountType: promo.discountType,
              discountValue: promo.discountValue,
            }
          : null,
        billingTerm,
        billingInterval,
        commitmentEndsAt: sub?.commitment_ends_at ?? null,
        termDiscountPct: pricing.termDiscountPct,
        amountPerInvoice: pricing.amountPerInvoice,
        packCode: sub?.pack_code ?? null,
        packSeats,
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
      const updated = returningRows<{ id: string }>(
        await em.query(
        `UPDATE subscription
            SET status = 'trialing',
                trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + ($2 || ' days')::interval,
                updated_at = now()
          WHERE tenant_id = $1
          RETURNING id`,
        [tenantId, String(d)],
      ),
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
      const updated = returningRows<{ id: string }>(
        await em.query(
        `UPDATE subscription
            SET status = $2, updated_at = now()${clearCancel}${setTrial}
          WHERE tenant_id = $1
          RETURNING id`,
        [tenantId, status],
      ),
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
      const updated = returningRows<{ id: string }>(
        await em.query(
        `UPDATE subscription SET cancel_at_period_end = $2, updated_at = now()
          WHERE tenant_id = $1 RETURNING id`,
        [tenantId, cancel],
      ),
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
      const updated = returningRows<{ id: string }>(
        await em.query(
        `UPDATE subscription SET current_period_end = $2, updated_at = now()
          WHERE tenant_id = $1 RETURNING id`,
        [tenantId, d.toISOString()],
      ),
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

  /** Paliers commerciaux avec leur prix et leur contenu. */
  getPacks() {
    return this.catalog.getCatalogPacks();
  }

  /** Ajuste le prix (ou le libellé / l'activation) d'un palier. */
  async updatePack(
    code: string,
    patch: { priceMonthly?: number | null; label?: string; active?: boolean },
  ) {
    if (patch.priceMonthly !== undefined && patch.priceMonthly !== null) {
      const v = Number(patch.priceMonthly);
      if (!Number.isFinite(v) || v < 0) {
        throw new BadRequestException('Prix invalide (doit être ≥ 0)');
      }
      patch.priceMonthly = Math.round(v * 100) / 100;
    }
    if (patch.label !== undefined && !patch.label.trim()) {
      throw new BadRequestException('Le libellé ne peut pas être vide');
    }
    const updated = await this.catalog.updatePack(code, patch);
    if (!updated) {
      throw new NotFoundException(`Palier ${code} introuvable`);
    }
    return updated;
  }

  /**
   * Editor pricing control (cahier §3.2/§3.7 B): changes a module's price/label/active state.
   * Takes effect immediately for quotes, the client console and MRR — no redeployment.
   */
  async updateCatalogModule(
    code: string,
    patch: {
      priceMonthly?: number | null;
      label?: string;
      active?: boolean;
      minTierLevel?: number | null;
    },
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
    if (patch.minTierLevel !== undefined && patch.minTierLevel !== null) {
      const lvl = Math.trunc(Number(patch.minTierLevel));
      if (!Number.isFinite(lvl) || lvl < 1) {
        throw new BadRequestException('Palier minimum invalide');
      }
      patch.minTierLevel = lvl;
    }
    const updated = await this.catalog.updateModule(code, patch);
    if (!updated) {
      throw new NotFoundException(`Module ${code} introuvable`);
    }
    return updated;
  }

  /* ── Formule d'abonnement et réglages tarifaires ── */

  /**
   * Change la formule d'un abonné : engagement (mensuel / annuel 12 mois) et rythme de
   * facturation (mensualisé / payé en une fois). L'annuel ouvre droit à la remise d'engagement.
   */
  async setBillingFormula(
    tenantId: string,
    term: string,
    interval: string,
  ): Promise<EditorTenantRow> {
    const base = await this.tenantBase(tenantId);
    await this.pricing.setBillingFormula(
      tenantId,
      term === 'annual' ? 'annual' : 'monthly',
      interval === 'yearly' ? 'yearly' : 'monthly',
    );
    return this.readTenantRow(base);
  }

  /** Réglages tarifaires globaux (dont la remise d'engagement annuel). */
  async getPricingSettings(): Promise<{ annualDiscountPct: number }> {
    return { annualDiscountPct: await this.pricing.getAnnualDiscountPct() };
  }

  async setAnnualDiscountPct(pct: number): Promise<{ annualDiscountPct: number }> {
    return { annualDiscountPct: await this.pricing.setAnnualDiscountPct(pct) };
  }

  /* ── Codes promo (cahier §3.7 B) ── */

  listPromoCodes(): Promise<PromoCode[]> {
    return this.promos.list();
  }

  createPromoCode(input: PromoCodeInput): Promise<PromoCode> {
    return this.promos.create(input);
  }

  updatePromoCode(id: string, input: PromoCodeInput): Promise<PromoCode> {
    return this.promos.update(id, input);
  }

  async deletePromoCode(id: string): Promise<{ deleted: boolean }> {
    const deleted = await this.promos.remove(id);
    if (!deleted) {
      throw new NotFoundException('Code promo introuvable');
    }
    return { deleted };
  }

  /**
   * Applies a promo code to a subscriber (or removes it with `code = null`). Validates usability
   * and counts a redemption only when a *new* code is attached, so re-applying the same code or
   * detaching it never inflates the counter.
   */
  async setTenantPromoCode(
    tenantId: string,
    code: string | null,
  ): Promise<EditorTenantRow> {
    const base = await this.tenantBase(tenantId);
    const promo = code ? await this.promos.requireUsable(code) : null;

    const attached = await runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT promo_code_id FROM subscription WHERE tenant_id = $1`,
        [tenantId],
      );
      if (rows.length === 0) {
        throw new BadRequestException('Aucune souscription pour ce tenant');
      }
      const previous: string | null = rows[0].promo_code_id;
      await em.query(
        `UPDATE subscription SET promo_code_id = $2, updated_at = now() WHERE tenant_id = $1`,
        [tenantId, promo?.id ?? null],
      );
      return promo && promo.id !== previous;
    });

    if (attached && promo) {
      await this.promos.countRedemption(promo.id);
    }
    return this.readTenantRow(base);
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
