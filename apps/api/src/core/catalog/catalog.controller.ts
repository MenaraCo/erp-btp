import { Controller, Get } from '@nestjs/common';
import { RequiresPermission } from '../rbac/requires-permission.decorator';
import { CatalogService } from './catalog.service';

/**
 * Read access to the commercial catalogue for the client subscription console (cahier §3.7 A).
 * Modules with their config-driven prices, and packs with their composition. Gated by RBAC
 * (subscription.manage) — this is admin configuration data, not a licensed module capability.
 */
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('modules')
  @RequiresPermission('subscription.manage')
  modules() {
    return this.catalog.getCatalogModules();
  }

  @Get('packs')
  @RequiresPermission('subscription.manage')
  packs() {
    return this.catalog.getCatalogPacks();
  }
}
