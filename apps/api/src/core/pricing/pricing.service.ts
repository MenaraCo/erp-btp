import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returningRows } from '../database/returning.util';
import { runInTenant } from '../tenancy/tenant-transaction';
import {
  computePricing,
  normaliseBilling,
  type BillingInterval,
  type BillingTerm,
  type PricingInput,
  type PricingResult,
} from './pricing.calc';

/** Valeurs de repli si le réglage n'a pas encore été écrit en base. */
const DEFAULT_ANNUAL_DISCOUNT_PCT = 10;
const DEFAULT_TRIAL_DAYS = 30;

export interface PlatformSetting {
  key: string;
  value: string;
  label: string | null;
}

/**
 * Accès aux réglages tarifaires globaux (table `platform_setting`, éditée par l'éditeur) et
 * point d'entrée applicatif du moteur de calcul `pricing.calc`.
 *
 * `platform_setting` est une table globale de l'éditeur : pas de tenant_id, pas de RLS.
 */
@Injectable()
export class PricingService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Remise d'engagement annuel en %, paramétrable depuis le back-office. */
  async getAnnualDiscountPct(): Promise<number> {
    const rows: Array<{ value: string }> = await this.dataSource.query(
      `SELECT value FROM platform_setting WHERE key = 'annual_discount_pct'`,
    );
    const v = Number(rows[0]?.value);
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : DEFAULT_ANNUAL_DISCOUNT_PCT;
  }

  /**
   * Durée de l'essai gratuit, en jours — réglable par l'éditeur.
   *
   * Vit ici parce que `platform_setting` est la table des réglages globaux de l'éditeur, dont ce
   * service est l'unique accesseur. C'est un levier commercial : allonger l'essai pour une
   * campagne ne doit pas demander un déploiement.
   */
  async getTrialDays(): Promise<number> {
    const rows: Array<{ value: string }> = await this.dataSource.query(
      `SELECT value FROM platform_setting WHERE key = 'trial_days'`,
    );
    const v = Math.trunc(Number(rows[0]?.value));
    return Number.isFinite(v) && v >= 1 ? Math.min(365, v) : DEFAULT_TRIAL_DAYS;
  }

  async setTrialDays(days: number): Promise<number> {
    const v = Math.trunc(Number(days));
    if (!Number.isFinite(v) || v < 1 || v > 365) {
      throw new BadRequestException('La durée d’essai doit être comprise entre 1 et 365 jours');
    }
    await this.dataSource.query(
      `INSERT INTO platform_setting (key, value, label)
       VALUES ('trial_days', $1, 'Durée de l''essai gratuit (jours)')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [String(v)],
    );
    return v;
  }

  async setAnnualDiscountPct(pct: number): Promise<number> {
    const v = Number(pct);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      throw new BadRequestException('La remise annuelle doit être comprise entre 0 et 100 %');
    }
    const rounded = Math.round(v * 100) / 100;
    await this.dataSource.query(
      `INSERT INTO platform_setting (key, value, label)
       VALUES ('annual_discount_pct', $1, 'Remise pour engagement annuel (%)')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [String(rounded)],
    );
    return rounded;
  }

  listSettings(): Promise<PlatformSetting[]> {
    return this.dataSource.query(
      `SELECT key, value, label FROM platform_setting ORDER BY key`,
    );
  }

  /** Calcule la tarification en injectant le taux de remise annuelle courant. */
  async compute(input: Omit<PricingInput, 'annualDiscountPct'>): Promise<PricingResult> {
    const annualDiscountPct = await this.getAnnualDiscountPct();
    return computePricing({ ...input, annualDiscountPct });
  }

  /**
   * Applique une formule (engagement + rythme) à la souscription d'un tenant. Pose la fin
   * d'engagement à +12 mois pour l'annuel, la retire sinon. Ne touche ni au statut ni aux modules.
   */
  async setBillingFormula(
    tenantId: string,
    term: BillingTerm,
    interval: BillingInterval,
  ): Promise<{ billingTerm: BillingTerm; billingInterval: BillingInterval; commitmentEndsAt: Date | null }> {
    const { billingTerm, billingInterval } = normaliseBilling(term, interval);
    // `subscription` est protégée par RLS : il faut le contexte tenant, sinon 0 ligne touchée.
    const rows = await runInTenant(this.dataSource, tenantId, async (em) =>
      returningRows<{ commitment_ends_at: Date | null }>(
        await em.query(
        // $2 est à la fois valeur de colonne et opérande de comparaison : on caste explicitement,
        // sinon PostgreSQL déduit deux types incompatibles pour le même paramètre.
        `UPDATE subscription
            SET billing_term = $2::varchar,
                billing_interval = $3::varchar,
                commitment_ends_at = CASE WHEN $2::varchar = 'annual'
                  THEN COALESCE(commitment_ends_at, now() + interval '12 months')
                  ELSE NULL END,
                updated_at = now()
          WHERE tenant_id = $1
          RETURNING commitment_ends_at`,
          [tenantId, billingTerm, billingInterval],
        ),
      ),
    );
    if (rows.length === 0) {
      throw new BadRequestException('Aucune souscription pour ce tenant');
    }
    return { billingTerm, billingInterval, commitmentEndsAt: rows[0].commitment_ends_at };
  }

  /**
   * Reconduction tacite à l'échéance de l'engagement annuel : l'abonnement bascule au mois le
   * mois (et perd donc la remise d'engagement). Idempotent — ne fait rien si l'échéance n'est pas
   * atteinte. Appelé à la demande, comme `applyExpiryIfDue` (pas encore de planificateur).
   */
  async applyCommitmentEndIfDue(tenantId: string): Promise<{ changed: boolean }> {
    const rows = await runInTenant(this.dataSource, tenantId, async (em) =>
      returningRows<{ id: string }>(
        await em.query(
          `UPDATE subscription
            SET billing_term = 'monthly',
                billing_interval = 'monthly',
                commitment_ends_at = NULL,
                updated_at = now()
          WHERE tenant_id = $1
            AND billing_term = 'annual'
            AND commitment_ends_at IS NOT NULL
            AND commitment_ends_at <= now()
            AND cancel_at_period_end = false
          RETURNING id`,
          [tenantId],
        ),
      ),
    );
    return { changed: rows.length > 0 };
  }
}
