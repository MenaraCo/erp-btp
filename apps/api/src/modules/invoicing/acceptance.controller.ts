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
  accept(
    @Param('devisId') devisId: string,
    @Body() body?: { chantierId?: string | null; retainedSectionIds?: string[] },
  ) {
    return this.acceptance.accept(
      devisId,
      body?.chantierId ?? null,
      body?.retainedSectionIds ?? [],
    );
  }

  /** File d'attente de l'écran : les commandes gagnées qui restent à accepter. */
  @Get('acceptance/pending')
  @RequiresAnyCapability('invoicing.situations', 'site_tracking.budget')
  @RequiresPermission('invoicing.read')
  pending() {
    return this.acceptance.listPending();
  }

  /** Historique : les commandes déjà transformées en marché + chantier. */
  @Get('acceptance/accepted')
  @RequiresAnyCapability('invoicing.situations', 'site_tracking.budget')
  @RequiresPermission('invoicing.read')
  accepted() {
    return this.acceptance.listAccepted();
  }

  /** Fiche d'acceptation d'un devis : client, montants, options à retenir, chantier cible. */
  @Get('acceptance/devis/:devisId')
  @RequiresAnyCapability('invoicing.situations', 'site_tracking.budget')
  @RequiresPermission('invoicing.read')
  sheet(@Param('devisId') devisId: string) {
    return this.acceptance.getSheet(devisId);
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
