import {
  BadRequestException,
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { TenantContext } from './tenant-context';
import { TenantResolverService } from './tenant-resolver.service';
import { AuthTokenService } from '../auth/auth-token.service';

/**
 * Establishes the tenant + user context for every (non-excluded) request.
 *
 * Source of truth: a valid Bearer access token (tenant + user derived from it). A present but
 * invalid token is rejected (401). With no token, falls back to dev resolution — tenant by
 * sub-domain / X-Tenant-Id, user by X-User-Id — which phase 0.7 keeps for local/testing only.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly resolver: TenantResolverService,
    private readonly context: TenantContext,
    private readonly tokens: AuthTokenService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      const resolved = this.tokens.verify(authHeader.slice(7));
      if (!resolved) {
        throw new UnauthorizedException('Invalid or expired access token');
      }
      this.context.run(
        { tenantId: resolved.tenantId, userId: resolved.userId },
        () => next(),
      );
      return;
    }

    const tenantId = await this.resolver.resolve(req);
    if (!tenantId) {
      throw new BadRequestException(
        'Tenant could not be resolved. Use a tenant sub-domain or the X-Tenant-Id header.',
      );
    }
    const rawUser = req.headers['x-user-id'];
    const userId = Array.isArray(rawUser) ? rawUser[0] : rawUser;
    this.context.run({ tenantId, userId }, () => next());
  }
}
