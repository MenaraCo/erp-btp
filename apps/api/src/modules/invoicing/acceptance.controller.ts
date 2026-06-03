import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { AcceptanceService } from './acceptance.service';

@Controller()
export class AcceptanceController {
  constructor(private readonly acceptance: AcceptanceService) {}

  /**
   * Acceptation unifiée (cahier §5.4) : un seul marché sur un chantier (nouveau ou existant)
   * portant facturation + étude d'exécution. Corps optionnel `{ chantierId }`.
   */
  @Post('affaires/:affaireId/accept')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.write')
  accept(@Param('affaireId') affaireId: string, @Body() body?: { chantierId?: string | null }) {
    return this.acceptance.accept(affaireId, body?.chantierId ?? null);
  }

  @Get('marches')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  list() {
    return this.acceptance.listMarches();
  }

  @Get('marches/:marcheId')
  @RequiresCapability('invoicing.situations')
  @RequiresPermission('invoicing.read')
  get(@Param('marcheId') marcheId: string) {
    return this.acceptance.getMarche(marcheId);
  }
}
