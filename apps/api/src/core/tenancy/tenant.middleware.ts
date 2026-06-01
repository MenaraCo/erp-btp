import { BadRequestException, Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { TenantContext } from './tenant-context';
import { TenantResolverService } from './tenant-resolver.service';

/**
 * Establishes the tenant context for every (non-excluded) request.
 * Rejects with 400 when no tenant can be resolved — public routes are excluded
 * by the module wiring, so they never reach this middleware.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly resolver: TenantResolverService,
    private readonly context: TenantContext,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const tenantId = await this.resolver.resolve(req);
    if (!tenantId) {
      throw new BadRequestException(
        'Tenant could not be resolved. Use a tenant sub-domain or the X-Tenant-Id header.',
      );
    }
    // Current user (dev): X-User-Id header. Replaced by the auth token subject in phase 0.7.
    const rawUser = req.headers['x-user-id'];
    const userId = Array.isArray(rawUser) ? rawUser[0] : rawUser;
    this.context.run({ tenantId, userId }, () => next());
  }
}
