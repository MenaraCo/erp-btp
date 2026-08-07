import { Controller, Get } from '@nestjs/common';
import { TenantContext } from '../tenancy/tenant-context';
import { RbacService } from '../rbac/rbac.service';
import { EntitlementsService } from './entitlements.service';

/**
 * Ce que l'utilisateur courant a le droit d'utiliser. Sert au menu et aux écrans : une entrée
 * dont la capacité manque est présentée comme non souscrite, plutôt que de mener à un 403.
 * Aucune garde de capacité ici — c'est précisément l'endpoint qui dit lesquelles on possède.
 *
 * Renvoie les DEUX axes, car ils répondent à deux questions différentes :
 *  - `capabilities` / `activeModules` (jetons) : à quels modules il accède — pilote le menu ;
 *  - `permissions` (rôles) : ce qu'il a le droit d'y faire — pilote les boutons d'écriture.
 */
@Controller('me')
export class MeController {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly rbac: RbacService,
    private readonly context: TenantContext,
  ) {}

  @Get('capabilities')
  async capabilities() {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId();
    const [capabilities, modules, permissions] = await Promise.all([
      this.entitlements.listCapabilitiesForUser(tenantId, userId),
      this.entitlements.getActiveModuleCodes(tenantId),
      this.rbac.listPermissionsForUser(tenantId, userId),
    ]);
    return { capabilities, activeModules: modules, permissions };
  }
}
