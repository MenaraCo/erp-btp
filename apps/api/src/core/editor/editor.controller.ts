import { Controller, Get, UseGuards } from '@nestjs/common';
import { EditorService } from './editor.service';
import { PlatformAdminGuard } from './platform-admin.guard';

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
}
