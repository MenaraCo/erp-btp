import { SetMetadata } from '@nestjs/common';

export const REQUIRES_PERMISSION = 'requiresPermission';

/**
 * Marks an endpoint/handler as requiring an RBAC permission. Enforced by PermissionGuard for
 * the current tenant + user. Orthogonal to @RequiresCapability — an endpoint may carry both.
 */
export const RequiresPermission = (permission: string) =>
  SetMetadata(REQUIRES_PERMISSION, permission);
