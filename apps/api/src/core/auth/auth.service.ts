import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runInTenant } from '../tenancy/tenant-transaction';
import { AuthTokenService } from './auth-token.service';
import { hashPassword, verifyPassword } from './password.util';
import {
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from './totp.util';

export interface LoginResult {
  accessToken: string;
}

/** Mot de passe correct mais 2FA active : l'écran doit réclamer le code (pas encore de jeton). */
export interface MfaChallenge {
  mfaRequired: true;
}

/**
 * First-party authentication: password (scrypt) + optional TOTP MFA, issuing HS256 access
 * tokens. Tenant-scoped reads/writes go through runInTenant so RLS applies. Methods take
 * tenantId/userId explicitly; the controller supplies them from the request context.
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokens: AuthTokenService,
  ) {}

  /**
   * Liste les sociétés (slug + nom) auxquelles un e-mail donné est rattaché, pour l'écran de
   * connexion : l'utilisateur saisit son e-mail puis CHOISIT sa société dans une liste, au lieu de
   * retaper un nom/slug (source du bug « je ne me reconnecte pas après l'inscription »).
   *
   * S'appuie sur la fonction SQL `companies_for_email` (SECURITY DEFINER) : une lecture
   * inter-tenants contrôlée qui ne renvoie QUE slug + nom, jamais de données sensibles. Le mot de
   * passe reste le vrai garde-fou à l'étape suivante.
   */
  async companiesForEmail(email: string): Promise<{ slug: string; name: string }[]> {
    const clean = (email ?? '').trim();
    if (!clean) return [];
    const rows = await this.dataSource.query(
      `SELECT slug, name FROM companies_for_email($1)`,
      [clean],
    );
    return rows.map((r: { slug: string; name: string }) => ({ slug: r.slug, name: r.name }));
  }

  /** Admin action: set or reset a user's password. */
  setPassword(tenantId: string, userId: string, password: string): Promise<void> {
    const hash = hashPassword(password);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await em.query(
        `UPDATE user_account SET password_hash = $1, updated_at = now() WHERE id = $2`,
        [hash, userId],
      );
    });
  }

  /**
   * Vérifie les identifiants (+ 2FA si active) et délivre un jeton. Si le mot de passe est bon mais
   * qu'un second facteur est requis et non fourni, renvoie `{ mfaRequired: true }` (pas de jeton) :
   * l'écran affiche alors le champ code. Le code accepté est soit le TOTP, soit un code de secours.
   */
  async login(
    tenantId: string,
    email: string,
    password: string,
    totpCode?: string,
  ): Promise<LoginResult | MfaChallenge> {
    const user = await runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT id, email, password_hash, mfa_enabled, mfa_secret, mfa_recovery_codes
           FROM user_account
          WHERE lower(email) = lower($1) AND status = 'active'`,
        [email],
      );
      return rows[0] ?? null;
    });

    // Generic error to avoid leaking which part failed (user enumeration).
    if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.mfa_enabled) {
      const code = (totpCode ?? '').trim();
      if (!code) {
        return { mfaRequired: true };
      }
      const okTotp = user.mfa_secret && verifyTotp(user.mfa_secret, code);
      if (!okTotp) {
        const consumed = await this.consumeRecoveryCode(
          tenantId,
          user.id,
          user.mfa_recovery_codes,
          code,
        );
        if (!consumed) {
          throw new UnauthorizedException('A valid MFA code is required');
        }
      }
    }

    return {
      accessToken: this.tokens.issueAccessToken(user.id, tenantId, user.email),
    };
  }

  /** Consomme un code de secours (usage unique) s'il correspond ; le retire de la liste. */
  private async consumeRecoveryCode(
    tenantId: string,
    userId: string,
    stored: unknown,
    code: string,
  ): Promise<boolean> {
    const codes: string[] = Array.isArray(stored) ? stored : [];
    const h = hashRecoveryCode(code);
    if (!codes.includes(h)) return false;
    const remaining = codes.filter((c) => c !== h);
    await runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `UPDATE user_account SET mfa_recovery_codes = $1::jsonb, updated_at = now() WHERE id = $2`,
        [JSON.stringify(remaining), userId],
      ),
    );
    return true;
  }

  /** État de la 2FA pour l'écran Sécurité. */
  getMfaStatus(tenantId: string, userId: string): Promise<{ enabled: boolean }> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT mfa_enabled FROM user_account WHERE id = $1`, [userId]);
      return { enabled: Boolean(rows[0]?.mfa_enabled) };
    });
  }

  /**
   * Étape 1 de l'activation : génère un secret (NON encore actif) et l'URI otpauth du QR.
   * On n'active pas tant que l'utilisateur n'a pas prouvé un code (étape 2) — pas de verrouillage.
   */
  setupMfa(tenantId: string, userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const secret = generateTotpSecret();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT email FROM user_account WHERE id = $1`, [userId]);
      const email = rows[0]?.email ?? 'compte';
      await em.query(
        `UPDATE user_account
            SET mfa_secret = $1, mfa_enabled = false, mfa_recovery_codes = NULL, updated_at = now()
          WHERE id = $2`,
        [secret, userId],
      );
      return { secret, otpauthUri: buildOtpauthUri(secret, email) };
    });
  }

  /** Étape 2 : vérifie un code, ACTIVE la 2FA et renvoie les codes de secours (montrés une fois). */
  confirmMfa(tenantId: string, userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT mfa_secret FROM user_account WHERE id = $1`, [userId]);
      const secret = rows[0]?.mfa_secret;
      if (!secret) {
        throw new BadRequestException('Générez d’abord un secret (étape 1).');
      }
      if (!verifyTotp(secret, (code ?? '').trim())) {
        throw new UnauthorizedException('Code invalide.');
      }
      const recoveryCodes = generateRecoveryCodes(10);
      const hashes = recoveryCodes.map(hashRecoveryCode);
      await em.query(
        `UPDATE user_account SET mfa_enabled = true, mfa_recovery_codes = $1::jsonb, updated_at = now() WHERE id = $2`,
        [JSON.stringify(hashes), userId],
      );
      return { recoveryCodes };
    });
  }

  // La 2FA est obligatoire (exigée dès la souscription de la société) : aucune méthode de
  // désactivation n'est fournie. Pour changer d'appareil, on relance setupMfa + confirmMfa, ce
  // qui remplace le secret et régénère les codes de secours.
}
