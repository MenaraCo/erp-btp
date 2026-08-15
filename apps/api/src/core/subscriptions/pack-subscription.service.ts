import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { runInTenant } from '../tenancy/tenant-transaction';

export interface PackRow {
  code: string;
  label: string;
  tierLevel: number;
  priceMonthly: number | null;
  /** Jetons ouverts par siège (réglable par l'éditeur ; défaut = nombre de modules du palier). */
  seatTokens: number;
  modules: string[];
  description: string | null;
}

export interface AddonRow {
  code: string;
  label: string;
  priceMonthly: number | null;
  minTierLevel: number | null;
  /** Souscrit par le tenant courant (jetons > 0). */
  seats: number;
  /** Souscriptible compte tenu du palier courant. */
  eligible: boolean;
}

export interface TenantPackState {
  packCode: string | null;
  packLabel: string | null;
  tierLevel: number | null;
  packSeats: number;
  addons: Array<{ code: string; label: string; seats: number }>;
}

/**
 * Souscription **par paliers** (cahier §3.2/§3.7 A). L'offre se vend en packs (Essentiel → Pro
 * Max) ; les add-ons restent à la carte mais exigent un palier minimum.
 *
 * Point d'architecture : rien de tout cela n'atteint la logique métier. Toute modification est
 * **reprojetée** sur `tenant_module`, la table que lit la garde de capacité — le packaging change,
 * le moteur de droits ne bouge pas (§3.1). `reproject()` est l'unique endroit qui écrit cette
 * projection, ce qui évite toute dérive entre le commercial et les droits réels.
 *
 * Les jetons portent sur le **pack** : un utilisateur qui en reçoit un accède à tous les modules
 * du palier. Les add-ons ont leurs propres jetons.
 */
@Injectable()
export class PackSubscriptionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Catalogue des paliers, du plus simple au plus complet. */
  async listPacks(): Promise<PackRow[]> {
    const rows = await this.dataSource.query(
      `SELECT p.code, p.label, p.tier_level, p.price_monthly, p.seat_tokens,
              COALESCE(array_agg(m.code ORDER BY m.code) FILTER (WHERE m.code IS NOT NULL), '{}') AS modules
         FROM pack p
         LEFT JOIN pack_module pm ON pm.pack_id = p.id
         LEFT JOIN module m ON m.id = pm.module_id
        WHERE p.active = true
        GROUP BY p.code, p.label, p.tier_level, p.price_monthly, p.seat_tokens
        ORDER BY p.tier_level`,
    );
    return rows.map(
      (r: {
        code: string;
        label: string;
        tier_level: number;
        price_monthly: string | null;
        seat_tokens: number | null;
        modules: string[];
      }) => ({
        code: r.code,
        label: r.label,
        tierLevel: Number(r.tier_level),
        priceMonthly: r.price_monthly === null ? null : Number(r.price_monthly),
        // Sans réglage éditeur, un siège ouvre un jeton par module du palier.
        seatTokens: r.seat_tokens === null ? r.modules.length : Number(r.seat_tokens),
        modules: r.modules,
        description: null,
      }),
    );
  }

  /** Palier et add-ons actuels du tenant. */
  getState(tenantId: string): Promise<TenantPackState> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const sub = (
        await em.query(
          `SELECT s.pack_code, s.pack_seats, p.label, p.tier_level
             FROM subscription s
             LEFT JOIN pack p ON p.code = s.pack_code
            WHERE s.tenant_id = $1`,
          [tenantId],
        )
      )[0];
      const addons = await em.query(
        `SELECT ms.module_code, ms.seats_purchased, m.label
           FROM module_subscription ms
           JOIN module m ON m.code = ms.module_code
          WHERE m.is_addon = true AND ms.seats_purchased > 0
            AND ms.billing_period <> 'trial'
          ORDER BY ms.module_code`,
      );
      return {
        packCode: sub?.pack_code ?? null,
        packLabel: sub?.label ?? null,
        tierLevel: sub?.tier_level == null ? null : Number(sub.tier_level),
        packSeats: Number(sub?.pack_seats ?? 0),
        addons: addons.map((a: { module_code: string; seats_purchased: number; label: string }) => ({
          code: a.module_code,
          label: a.label,
          seats: Number(a.seats_purchased),
        })),
      };
    });
  }

  /** Add-ons du catalogue, avec leur éligibilité au palier courant du tenant. */
  async listAddons(tenantId: string): Promise<AddonRow[]> {
    const state = await this.getState(tenantId);
    const tier = state.tierLevel ?? 0;
    const catalogue = await this.dataSource.query(
      `SELECT code, label, price_monthly, min_tier_level
         FROM module WHERE is_addon = true AND active = true ORDER BY code`,
    );
    const seatsByCode = new Map(state.addons.map((a) => [a.code, a.seats]));
    return catalogue.map(
      (m: {
        code: string;
        label: string;
        price_monthly: string | null;
        min_tier_level: number | null;
      }) => ({
        code: m.code,
        label: m.label,
        priceMonthly: m.price_monthly === null ? null : Number(m.price_monthly),
        minTierLevel: m.min_tier_level === null ? null : Number(m.min_tier_level),
        seats: seatsByCode.get(m.code) ?? 0,
        eligible: m.min_tier_level === null || tier >= Number(m.min_tier_level),
      }),
    );
  }

  /**
   * Souscrit (ou change) le palier. Un changement de palier réévalue les add-ons : ceux dont le
   * palier minimum n'est plus atteint sont désactivés (jamais supprimés — les données restent).
   */
  async subscribeToPack(
    tenantId: string,
    packCode: string,
    seats: number,
  ): Promise<TenantPackState> {
    const s = Math.trunc(Number(seats));
    if (!Number.isFinite(s) || s < 1) {
      throw new BadRequestException('Le nombre de jetons doit être au moins 1');
    }
    const pack = (
      await this.dataSource.query(
        `SELECT code, tier_level FROM pack WHERE code = $1 AND active = true`,
        [packCode],
      )
    )[0];
    if (!pack) {
      throw new BadRequestException(`Palier inconnu : ${packCode}`);
    }

    await runInTenant(this.dataSource, tenantId, async (em) => {
      const updated = await em.query(
        `UPDATE subscription
            SET pack_code = $2::varchar, pack_seats = $3,
                -- Choisir un palier n'ouvre pas les droits : un essai reste un essai, et une
                -- souscription qui attend son premier paiement continue de l'attendre.
                status = CASE WHEN status IN ('trialing', 'incomplete') THEN status
                              ELSE 'active' END,
                updated_at = now()
          WHERE tenant_id = $1`,
        [tenantId, pack.code, s],
      );
      void updated;
      const exists = await em.query(
        `SELECT 1 FROM subscription WHERE tenant_id = $1`,
        [tenantId],
      );
      if (exists.length === 0) {
        throw new BadRequestException('Aucune souscription pour ce tenant');
      }
      await this.reproject(em, tenantId);
    });
    return this.getState(tenantId);
  }

  /**
   * Ajoute/ajuste un add-on (jetons > 0) ou le retire (jetons = 0). Refuse si le palier courant
   * est insuffisant — c'est la règle « pas d'IA sur l'entrée de gamme ».
   */
  async setAddon(
    tenantId: string,
    moduleCode: string,
    seats: number,
  ): Promise<TenantPackState> {
    const s = Math.trunc(Number(seats));
    if (!Number.isFinite(s) || s < 0) {
      throw new BadRequestException('Nombre de jetons invalide');
    }
    const mod = (
      await this.dataSource.query(
        `SELECT code, label, is_addon, min_tier_level FROM module WHERE code = $1 AND active = true`,
        [moduleCode],
      )
    )[0];
    if (!mod) {
      throw new BadRequestException(`Module inconnu : ${moduleCode}`);
    }
    if (!mod.is_addon) {
      throw new BadRequestException(
        `« ${mod.label} » n'est pas une option : il est inclus dans les paliers.`,
      );
    }

    const state = await this.getState(tenantId);
    if (!state.packCode) {
      throw new BadRequestException(
        'Souscrivez d’abord un palier : les options se prennent par-dessus un abonnement.',
      );
    }
    const required = mod.min_tier_level === null ? null : Number(mod.min_tier_level);
    if (s > 0 && required !== null && (state.tierLevel ?? 0) < required) {
      const needed = (
        await this.dataSource.query(
          `SELECT label FROM pack WHERE tier_level = $1 AND active = true LIMIT 1`,
          [required],
        )
      )[0];
      throw new BadRequestException(
        `« ${mod.label} » nécessite au minimum le palier ${needed?.label ?? required}.`,
      );
    }

    await runInTenant(this.dataSource, tenantId, async (em) => {
      const sub = (
        await em.query(`SELECT id FROM subscription WHERE tenant_id = $1`, [tenantId])
      )[0];
      if (!sub) {
        throw new BadRequestException('Aucune souscription pour ce tenant');
      }
      await em.query(
        `INSERT INTO module_subscription
           (tenant_id, subscription_id, module_code, seats_purchased, billing_period, read_only)
         VALUES ($1, $2, $3, $4, 'monthly', $5)
         ON CONFLICT (subscription_id, module_code)
         DO UPDATE SET seats_purchased = EXCLUDED.seats_purchased,
                       read_only = EXCLUDED.read_only,
                       -- la ligne devient une option payante : elle sort du provisionnement d'essai
                       billing_period = EXCLUDED.billing_period,
                       updated_at = now()`,
        [tenantId, sub.id, mod.code, s, s === 0],
      );
      await this.reproject(em, tenantId);
    });
    return this.getState(tenantId);
  }

  /**
   * Reconstruit `tenant_module` à partir du palier et des add-ons éligibles — **unique** écriture
   * de la projection commerciale vers les droits. Ce qui n'est plus couvert passe en lecture seule
   * (`active = false`), jamais supprimé : les données du client restent intactes (§3.4).
   */
  async reproject(em: EntityManager, tenantId: string): Promise<void> {
    const sub = (
      await em.query(
        `SELECT s.pack_code, s.pack_seats, s.status, p.tier_level
           FROM subscription s
           LEFT JOIN pack p ON p.code = s.pack_code
          WHERE s.tenant_id = $1`,
        [tenantId],
      )
    )[0];
    if (!sub) return;

    const open = sub.status === 'active' || sub.status === 'trialing';
    const packSeats = Number(sub.pack_seats ?? 0);
    const tier = sub.tier_level == null ? 0 : Number(sub.tier_level);

    const desired = new Map<string, number>();
    if (sub.pack_code) {
      const packModules = await em.query(
        `SELECT m.code FROM pack p
           JOIN pack_module pm ON pm.pack_id = p.id
           JOIN module m ON m.id = pm.module_id
          WHERE p.code = $1`,
        [sub.pack_code],
      );
      for (const m of packModules) desired.set(m.code, packSeats);
    }
    // Add-ons souscrits, retenus seulement si le palier courant les autorise.
    const addons = await em.query(
      `SELECT ms.module_code, ms.seats_purchased, m.min_tier_level
         FROM module_subscription ms
         JOIN module m ON m.code = ms.module_code
        WHERE m.is_addon = true AND ms.seats_purchased > 0
          AND ms.billing_period <> 'trial'`,
    );
    for (const a of addons) {
      const required = a.min_tier_level == null ? null : Number(a.min_tier_level);
      if (required === null || tier >= required) {
        desired.set(a.module_code, Number(a.seats_purchased));
      }
    }

    for (const [code, seats] of desired) {
      await em.query(
        `INSERT INTO tenant_module (tenant_id, module_code, seats_purchased, active, read_only)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, module_code)
         DO UPDATE SET seats_purchased = EXCLUDED.seats_purchased, active = EXCLUDED.active,
                       read_only = EXCLUDED.read_only, updated_at = now()`,
        [tenantId, code, seats, open, !open],
      );
    }
    // Tout ce qui n'est plus couvert : lecture seule, sans perte de données.
    const codes = [...desired.keys()];
    await em.query(
      `UPDATE tenant_module SET active = false, read_only = true, updated_at = now()
        WHERE tenant_id = $1 AND module_code <> ALL($2::varchar[])`,
      [tenantId, codes],
    );
  }
}
