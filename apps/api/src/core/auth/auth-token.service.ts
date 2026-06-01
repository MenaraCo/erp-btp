import { Injectable } from '@nestjs/common';
import { loadAppConfig } from '../../config/env.config';
import { JwtPayload, signJwt, verifyJwt } from './jwt.util';

export interface ResolvedToken {
  tenantId: string;
  userId: string;
  email?: string;
}

/**
 * Issues and verifies first-party access tokens. Has no dependency on the tenancy layer so it
 * can be injected by the tenant middleware without creating a circular module dependency.
 */
@Injectable()
export class AuthTokenService {
  private readonly config = loadAppConfig();

  issueAccessToken(userId: string, tenantId: string, email?: string): string {
    const payload: JwtPayload = { sub: userId, tid: tenantId, email };
    return signJwt(payload, this.config.jwtSecret, this.config.accessTokenTtlSec);
  }

  verify(token: string): ResolvedToken | null {
    const payload = verifyJwt(token, this.config.jwtSecret);
    if (!payload) {
      return null;
    }
    return { tenantId: payload.tid, userId: payload.sub, email: payload.email };
  }
}
