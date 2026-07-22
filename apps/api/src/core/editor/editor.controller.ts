import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EditorService } from './editor.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import type { PromoCodeInput } from '../promo/promo-code.service';

interface ExtendTrialInput {
  days?: number;
}
interface StatusInput {
  status?: string;
  trialDays?: number;
}
interface CancelInput {
  cancel?: boolean;
}
interface PeriodEndInput {
  date?: string;
}
interface ModuleInput {
  moduleCode?: string;
  seats?: number;
}
interface CatalogModuleInput {
  priceMonthly?: number | null;
  label?: string;
  active?: boolean;
  minTierLevel?: number | null;
}
interface CatalogPackInput {
  priceMonthly?: number | null;
  label?: string;
  active?: boolean;
}
interface TenantPromoInput {
  code?: string | null;
}
interface BillingFormulaInput {
  billingTerm?: string;
  billingInterval?: string;
}
interface AnnualDiscountInput {
  annualDiscountPct?: number;
}

/**
 * Editor back-office API (cahier §3.7 B) — reserved to the platform owner via PlatformAdminGuard,
 * never exposed to client tenants. Read-only overview + subscriber list for this first increment;
 * catalogue editing, promo codes and support actions come next.
 */
@Controller('editor')
@UseGuards(PlatformAdminGuard)
export class EditorController {
  constructor(private readonly editor: EditorService) {}

  /** Platform KPIs: MRR/ARR, counts by status, trials ending soon, conversion. */
  @Get('overview')
  overview() {
    return this.editor.getOverview();
  }

  /** Every subscriber with its status, modules, seats and MRR contribution. */
  @Get('tenants')
  tenants() {
    return this.editor.getTenants();
  }

  /** Support action: extend a tenant's trial by `days` (default 30). */
  @Post('tenants/:id/extend-trial')
  extendTrial(@Param('id') id: string, @Body() body: ExtendTrialInput) {
    return this.editor.extendTrial(id, Number(body?.days ?? 30));
  }

  /** Support action: force a subscription to active (offline payment / commercial gesture). */
  @Post('tenants/:id/activate')
  activate(@Param('id') id: string) {
    return this.editor.forceActivate(id);
  }

  /** Move the subscription to any lifecycle status (active/trialing/paused/past_due/canceled). */
  @Post('tenants/:id/status')
  setStatus(@Param('id') id: string, @Body() body: StatusInput) {
    return this.editor.setStatus(
      id,
      (body?.status ?? '') as never,
      body?.trialDays ? Number(body.trialDays) : undefined,
    );
  }

  /** Program or revoke cancellation at the end of the current period. */
  @Post('tenants/:id/cancel')
  cancel(@Param('id') id: string, @Body() body: CancelInput) {
    return this.editor.setCancelAtPeriodEnd(id, body?.cancel ?? true);
  }

  /** Set the end of the current billing period (échéance). */
  @Post('tenants/:id/period-end')
  periodEnd(@Param('id') id: string, @Body() body: PeriodEndInput) {
    return this.editor.setPeriodEnd(id, body?.date ?? '');
  }

  /** Add/adjust a module (seats>0) or deactivate it (seats=0). */
  @Post('tenants/:id/module')
  module(@Param('id') id: string, @Body() body: ModuleInput) {
    return this.editor.setModule(id, body?.moduleCode ?? '', Number(body?.seats ?? 0));
  }

  /** Commercial catalogue with the prices stored in database. */
  @Get('catalog')
  catalog() {
    return this.editor.getCatalog();
  }

  /**
   * Updates a module's commercial attributes (price €HT/siège/mois, libellé, actif).
   * `priceMonthly: null` = sur devis. Takes effect immediately, no redeployment.
   */
  @Post('catalog/modules/:code')
  updateCatalogModule(@Param('code') code: string, @Body() body: CatalogModuleInput) {
    return this.editor.updateCatalogModule(code, body ?? {});
  }

  /** Paliers commerciaux avec prix et contenu. */
  @Get('packs')
  packs() {
    return this.editor.getPacks();
  }

  /** Ajuste le prix d'un palier — effet immédiat, sans redéploiement. */
  @Post('packs/:code')
  updatePack(@Param('code') code: string, @Body() body: CatalogPackInput) {
    return this.editor.updatePack(code, body ?? {});
  }

  /* ── Codes promo ── */

  @Get('promo-codes')
  promoCodes() {
    return this.editor.listPromoCodes();
  }

  @Post('promo-codes')
  createPromoCode(@Body() body: PromoCodeInput) {
    return this.editor.createPromoCode(body ?? {});
  }

  @Post('promo-codes/:id')
  updatePromoCode(@Param('id') id: string, @Body() body: PromoCodeInput) {
    return this.editor.updatePromoCode(id, body ?? {});
  }

  @Delete('promo-codes/:id')
  deletePromoCode(@Param('id') id: string) {
    return this.editor.deletePromoCode(id);
  }

  /** Applies a promo code to a subscriber, or removes it with `{ code: null }`. */
  @Post('tenants/:id/promo')
  setTenantPromo(@Param('id') id: string, @Body() body: TenantPromoInput) {
    const code = body?.code ?? null;
    return this.editor.setTenantPromoCode(id, code ? String(code) : null);
  }

  /** Change la formule d'un abonné : engagement mensuel/annuel et rythme mensualisé/annuel. */
  @Post('tenants/:id/billing-formula')
  setBillingFormula(@Param('id') id: string, @Body() body: BillingFormulaInput) {
    return this.editor.setBillingFormula(
      id,
      body?.billingTerm ?? 'monthly',
      body?.billingInterval ?? 'monthly',
    );
  }

  /* ── Réglages tarifaires ── */

  @Get('pricing-settings')
  pricingSettings() {
    return this.editor.getPricingSettings();
  }

  @Post('pricing-settings')
  setPricingSettings(@Body() body: AnnualDiscountInput) {
    return this.editor.setAnnualDiscountPct(Number(body?.annualDiscountPct));
  }
}
