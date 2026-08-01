import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequiresAnyCapability } from '../../core/entitlements/requires-any-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { AcceptanceService } from './acceptance.service';

@Controller()
export class AcceptanceController {
  constructor(private readonly acceptance: AcceptanceService) {}

  /**
   * Acceptation unifiée (cahier §5.4) : un seul marché sur un chantier (nouveau ou existant)
   * portant facturation + étude d'exécution. Corps optionnel `{ chantierId }`.
   */
  /**
   * L'acceptation de commande est la charnière entre l'étude de prix et l'exécution : elle n'a
   * d'intérêt que si l'on facture OU si l'on suit des chantiers. Une seule des deux capacités
   * suffit donc à l'ouvrir.
   */
  @Post('devis/:devisId/accept')
  @RequiresAnyCapability('invoicing.situations', 'site_tracking.budget')
  @RequiresPermission('invoicing.write')
  accept(@Param('devisId') devisId: string, @Body() body?: { chantierId?: string | null }) {
    return this.acceptance.accept(devisId, body?.chantierId ?? null);
  }

  @Get('marches')
  @RequiresAnyCapability('invoicing.situations', 'site_tracking.budget')
  @RequiresPermission('invoicing.read')
  list() {
    return this.acceptance.listMarches();
  }

  @Get('marches/:marcheId')
  @RequiresAnyCapability('invoicing.situations', 'site_tracking.budget')
  @RequiresPermission('invoicing.read')
  get(@Param('marcheId') marcheId: string) {
    return this.acceptance.getMarche(marcheId);
  }
}
