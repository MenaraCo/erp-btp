import { Controller, Get } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PricingService } from '../pricing/pricing.service';

/**
 * Public commercial catalogue for the sign-up page (cahier §3.3) — no auth, no tenant. Serves the
 * same config-driven module prices and pack composition as the in-app catalogue, so a visitor can
 * choose modules before an account exists. Excluded from the tenant middleware in AppModule; it
 * carries no capability/permission decorator, so the global guards let it through.
 */
@Controller('public/catalog')
export class PublicCatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly pricing: PricingService,
  ) {}

  @Get('modules')
  modules() {
    return this.catalog.getCatalogModules();
  }

  @Get('packs')
  packs() {
    return this.catalog.getCatalogPacks();
  }

  /** Conditions tarifaires publiques (remise d'engagement annuel), pour la page d'inscription. */
  @Get('pricing')
  async pricing_() {
    return { annualDiscountPct: await this.pricing.getAnnualDiscountPct() };
  }
}
