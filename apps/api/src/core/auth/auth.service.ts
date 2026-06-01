import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runInTenant } from '../tenancy/tenant-transaction';
import { AuthTokenService } from './auth-token.service';
import { hashPassword, verifyPassword } from './password.util';
import { generateTotpSecret, verifyTotp } from './totp.util';

export interface LoginResult {
  accessToken: string;
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

  /** Verifies credentials (and TOTP when MFA is enabled) and issues an access token. */
  async login(
    tenantId: string,
    email: string,
    password: string,
    totpCode?: string,
  ): Promise<LoginResult> {
    const user = await runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT id, email, password_hash, mfa_enabled, mfa_secret
           FROM user_account
          WHERE email = $1 AND status = 'active'`,
        [email],
      );
      return rows[0] ?? null;
    });

    // Generic error to avoid leaking which part failed (user enumeration).
    if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.mfa_enabled) {
      if (!totpCode || !user.mfa_secret || !verifyTotp(user.mfa_secret, totpCode)) {
        throw new UnauthorizedException('A valid MFA code is required');
      }
    }

    return {
      accessToken: this.tokens.issueAccessToken(user.id, tenantId, user.email),
    };
  }

  /** Enables TOTP MFA for a user and returns the new secret (to display as a QR/otpauth). */
  enableMfa(tenantId: string, userId: string): Promise<{ secret: string }> {
    const secret = generateTotpSecret();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await em.query(
        `UPDATE user_account SET mfa_enabled = true, mfa_secret = $1, updated_at = now() WHERE id = $2`,
        [secret, userId],
      );
      return { secret };
    });
  }
}
