import { Controller, Get } from '@nestjs/common';
import { TenantContext } from '../tenancy/tenant-context';
import { EntitlementsService } from './entitlements.service';

/**
 * Ce que l'utilisateur courant a le droit d'utiliser. Sert au menu et aux écrans : une entrée
 * dont la capacité manque est présentée comme non souscrite, plutôt que de mener à un 403.
 * Aucune garde de capacité ici — c'est précisément l'endpoint qui dit lesquelles on possède.
 */
@Controller('me')
export class MeController {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly context: TenantContext,
  ) {}

  @Get('capabilities')
  async capabilities() {
    const tenantId = this.context.requireTenantId();
    const [capabilities, modules] = await Promise.all([
      this.entitlements.listCapabilitiesForUser(tenantId, this.context.getUserId()),
      this.entitlements.getActiveModuleCodes(tenantId),
    ]);
    return { capabilities, activeModules: modules };
  }
}
