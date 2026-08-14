import { Controller, Get, Param } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PricingService } from '../pricing/pricing.service';
import { PromoCodeService } from '../promo/promo-code.service';

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
    private readonly promos: PromoCodeService,
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

  /**
   * Valide un code promo pour l'écran d'inscription et renvoie sa remise, afin d'afficher AU CLIENT
   * le montant réellement dû avant paiement. On n'expose que le nécessaire (type + valeur) et
   * uniquement si le code est utilisable ; sinon `{ usable: false }`, sans détailler la raison.
   * Le prix facturé reste calculé côté serveur au paiement — cet aperçu ne fait pas foi seul.
   */
  @Get('promo/:code')
  async promo(@Param('code') code: string) {
    const promo = await this.promos.findByCode(code);
    if (!promo || !promo.usable) {
      return { code: (code ?? '').trim().toUpperCase(), usable: false };
    }
    return {
      code: promo.code,
      usable: true,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
    };
  }
}
