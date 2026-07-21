import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EditorService } from './editor.service';
import { PlatformAdminGuard } from './platform-admin.guard';

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
}
