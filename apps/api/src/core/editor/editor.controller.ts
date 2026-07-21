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
}
