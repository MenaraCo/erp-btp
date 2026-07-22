import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../tenancy/tenant-context';
import { runInTenant } from '../tenancy/tenant-transaction';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { RbacService } from '../rbac/rbac.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { PricingService } from '../pricing/pricing.service';
import { PromoCodeService } from '../promo/promo-code.service';
import type { BillingInterval, BillingTerm } from '../pricing/pricing.calc';

export type RegisterMode = 'trial' | 'direct';

export interface RegisterInput {
  companyName: string;
  fullName: string;
  email: string;
  password: string;
  mode: RegisterMode;
  /** Porte 2 (direct): modules chosen with their seat counts. `core` is always added. */
  modules?: Array<{ moduleCode: string; seats: number }>;
  /** Porte 2 : engagement (`monthly` sans engagement, `annual` 12 mois remisés). */
  billingTerm?: BillingTerm;
  /** Porte 2 : rythme de facturation (`monthly` mensualisé, `yearly` payé en une fois). */
  billingInterval?: BillingInterval;
  /** Code promo saisi à l'inscription (optionnel). */
  promoCode?: string | null;
}

export interface RegisterResult {
  accessToken: string;
  tenantSlug: string;
  tenantId: string;
  mode: RegisterMode;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Public sign-up (cahier des charges §3.3) — the two parallel entry doors. Creates a tenant + an
 * admin user, then either starts the 30-day trial (Porte 1, `trialing`, all modules) or a direct
 * subscription (Porte 2, `active`, chosen modules). Assigns the admin a seat (jeton) on every
 * active module so the account is immediately usable, and returns an access token (auto-login).
 *
 * This is the one legitimately tenant-less endpoint besides health: it *creates* the tenant, so it
 * runs outside the tenant middleware and manages the tenant context itself.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly subscriptions: SubscriptionService,
    private readonly auth: AuthService,
    private readonly tokens: AuthTokenService,
    private readonly rbac: RbacService,
    private readonly entitlements: EntitlementsService,
    private readonly pricing: PricingService,
    private readonly promos: PromoCodeService,
  ) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    const companyName = (input.companyName ?? '').trim();
    const fullName = (input.fullName ?? '').trim();
    const email = (input.email ?? '').trim().toLowerCase();
    const password = input.password ?? '';
    const mode: RegisterMode = input.mode === 'direct' ? 'direct' : 'trial';

    if (!companyName) throw new BadRequestException('companyName is required');
    if (!fullName) throw new BadRequestException('fullName is required');
    if (!EMAIL_RE.test(email)) throw new BadRequestException('A valid email is required');
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    // Porte 2: normalise the chosen modules (core is always active — Socle obligatoire).
    let directModules: Array<{ moduleCode: string; seats: number }> = [];
    if (mode === 'direct') {
      const chosen = (input.modules ?? []).filter(
        (m) => m && m.moduleCode && Number(m.seats) > 0,
      );
      const byCode = new Map(chosen.map((m) => [m.moduleCode, Math.trunc(Number(m.seats))]));
      byCode.set('core', Math.max(1, byCode.get('core') ?? 1));
      directModules = [...byCode.entries()].map(([moduleCode, seats]) => ({ moduleCode, seats }));
      if (directModules.length <= 1) {
        throw new BadRequestException(
          'Choisissez au moins un module métier pour un abonnement direct',
        );
      }
    }

    const slug = await this.allocateSlug(companyName);

    const tenantId: string = (
      await this.dataSource.query(
        `INSERT INTO tenant (slug, name) VALUES ($1, $2) RETURNING id`,
        [slug, companyName],
      )
    )[0].id;

    // Everything below is tenant-scoped: establish the context we just created.
    const userId = await this.context.run({ tenantId }, async () => {
      if (mode === 'trial') {
        await this.subscriptions.startTrial(tenantId);
      } else {
        await this.subscriptions.subscribeDirect(tenantId, directModules);
      }

      const uid: string = (
        await runInTenant(this.dataSource, tenantId, (em) =>
          em.query(
            `INSERT INTO user_account (tenant_id, email, full_name) VALUES ($1, $2, $3) RETURNING id`,
            [tenantId, email, fullName],
          ),
        )
      )[0].id;

      await this.auth.setPassword(tenantId, uid, password);
      await this.rbac.provisionSystemRoles(tenantId);
      await this.rbac.assignRole(tenantId, uid, 'admin');

      // Porte 2 : formule choisie (engagement + rythme) et code promo éventuel.
      if (mode === 'direct') {
        await this.pricing.setBillingFormula(
          tenantId,
          input.billingTerm === 'annual' ? 'annual' : 'monthly',
          input.billingInterval === 'yearly' ? 'yearly' : 'monthly',
        );
        const code = (input.promoCode ?? '').trim();
        if (code) {
          const promo = await this.promos.requireUsable(code);
          await runInTenant(this.dataSource, tenantId, (em) =>
            em.query(`UPDATE subscription SET promo_code_id = $2 WHERE tenant_id = $1`, [
              tenantId,
              promo.id,
            ]),
          );
          await this.promos.countRedemption(promo.id);
        }
      }

      // Give the admin a jeton on every active module so the account is usable right away.
      const activeModules = await this.entitlements.getActiveModuleCodes(tenantId);
      for (const code of activeModules) {
        await this.entitlements.assignSeat(tenantId, code, uid);
      }
      return uid;
    });

    return {
      accessToken: this.tokens.issueAccessToken(userId, tenantId, email),
      tenantSlug: slug,
      tenantId,
      mode,
    };
  }

  /** Builds a URL-safe slug from the company name and ensures it is unique (appends -2, -3, …). */
  private async allocateSlug(companyName: string): Promise<string> {
    const base =
      companyName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'entreprise';

    let candidate = base;
    for (let i = 2; i < 1000; i++) {
      const rows = await this.dataSource.query(
        `SELECT 1 FROM tenant WHERE slug = $1 LIMIT 1`,
        [candidate],
      );
      if (rows.length === 0) return candidate;
      candidate = `${base}-${i}`;
    }
    throw new BadRequestException('Could not allocate a unique slug for this company name');
  }
}
