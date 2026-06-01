import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContext } from '../tenancy/tenant-context';
import { RbacService } from './rbac.service';
import { REQUIRES_PERMISSION } from './requires-permission.decorator';

/**
 * Global guard enforcing @RequiresPermission for the current tenant + user. Handlers without
 * the decorator pass through. Runs alongside CapabilityGuard (both must pass when both apply).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: TenantContext,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRES_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) {
      return true;
    }
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId();
    const allowed = await this.rbac.hasPermission(tenantId, userId, permission);
    if (!allowed) {
      throw new ForbiddenException(`Missing permission "${permission}"`);
    }
    return true;
  }
}
