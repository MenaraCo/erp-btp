import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { loadAppConfig } from '../../config/env.config';
import { TenantContext } from '../tenancy/tenant-context';

/**
 * Guards the editor back-office (cahier §3.7 B): only the platform owner may enter, never a client
 * tenant admin. Access is granted solely by the current user's email being in the configured
 * PLATFORM_ADMIN_EMAILS allow-list — a hard, config-driven separation from client RBAC.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly allow = new Set(loadAppConfig().platformAdminEmails);

  constructor(private readonly context: TenantContext) {}

  canActivate(_ctx: ExecutionContext): boolean {
    const email = this.context.getEmail()?.trim().toLowerCase();
    if (!email || !this.allow.has(email)) {
      throw new ForbiddenException('Accès réservé à l’éditeur de la plateforme');
    }
    return true;
  }
}
