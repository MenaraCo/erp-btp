import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContext } from '../tenancy/tenant-context';
import { EntitlementsService } from './entitlements.service';
import { REQUIRES_CAPABILITY } from './requires-capability.decorator';

/**
 * Global guard: when a handler/class is marked with @RequiresCapability, enforces it for
 * the current tenant + user. Handlers without the decorator pass through untouched.
 * This is the single source of truth — the frontend never decides access.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: TenantContext,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRES_CAPABILITY,
      [context.getHandler(), context.getClass()],
    );
    if (!capability) {
      return true;
    }
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId();
    await this.entitlements.assertCapability(tenantId, userId, capability);
    return true;
  }
}
