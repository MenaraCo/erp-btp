import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { LibraryTransferService, PorteeBibliotheque } from './library-transfer.service';

interface TransfertBody {
  sourceId?: string;
  cibleId?: string;
  ids?: string[];
}

/**
 * Passerelle entre la bibliothèque d'étude de prix et celle du module chantier.
 *
 * UN sens = UNE paire d'endpoints, gardée par la permission de sa CIBLE : écrire dans le
 * catalogue du chantier relève du suivi de chantier, écrire dans celui de l'étude relève de
 * l'étude de prix. Un endpoint unique aurait exigé une garde « au plus permissif », qui aurait
 * laissé chacun écrire chez l'autre.
 *
 * La portée des bibliothèques est vérifiée à chaque appel : on ne peut pas se servir de l'endpoint
 * « vers le chantier » pour écrire dans une bibliothèque d'étude.
 */
@Controller('transfert-bibliotheque')
export class LibraryTransferController {
  constructor(private readonly transfert: LibraryTransferService) {}

  /** Bibliothèques du module chantier — la liste des cibles possibles. */
  @Get('bibliotheques-chantier')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  bibliothequesChantier() {
    return this.transfert.listerBibliotheques('chantier');
  }

  /* ── Étude → chantier : on écrit dans le catalogue du chantier ────────────────────────── */

  @Get('vers-chantier/apercu')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  async apercuVersChantier(
    @Query('sourceId') sourceId: string,
    @Query('cibleId') cibleId: string,
  ) {
    await this.assertSens(sourceId, cibleId, 'etude', 'chantier');
    return this.transfert.apercu(sourceId, cibleId);
  }

  @Post('vers-chantier')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  async versChantier(@Body() body: TransfertBody) {
    await this.assertSens(body?.sourceId, body?.cibleId, 'etude', 'chantier');
    return this.transfert.transferer(body!.sourceId!, body!.cibleId!, body?.ids ?? []);
  }

  /* ── Chantier → étude : on écrit dans le catalogue d'étude ────────────────────────────── */

  @Get('vers-etude/apercu')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  async apercuVersEtude(
    @Query('sourceId') sourceId: string,
    @Query('cibleId') cibleId: string,
  ) {
    await this.assertSens(sourceId, cibleId, 'chantier', 'etude');
    return this.transfert.apercu(sourceId, cibleId);
  }

  @Post('vers-etude')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  async versEtude(@Body() body: TransfertBody) {
    await this.assertSens(body?.sourceId, body?.cibleId, 'chantier', 'etude');
    return this.transfert.transferer(body!.sourceId!, body!.cibleId!, body?.ids ?? []);
  }

  /**
   * Le sens demandé doit correspondre à la portée RÉELLE des deux bibliothèques : sans cette
   * vérification, la garde de l'endpoint ne protégerait rien — il suffirait d'appeler
   * « vers-chantier » avec une bibliothèque d'étude en cible pour la modifier sans en avoir le droit.
   */
  private async assertSens(
    sourceId: string | undefined,
    cibleId: string | undefined,
    porteeSource: PorteeBibliotheque,
    porteeCible: PorteeBibliotheque,
  ): Promise<void> {
    if (!sourceId || !cibleId) {
      throw new BadRequestException('La bibliothèque source et la bibliothèque cible sont requises.');
    }
    const [s, c] = await Promise.all([
      this.transfert.porteeDe(sourceId),
      this.transfert.porteeDe(cibleId),
    ]);
    const nom = { etude: 'd’étude de prix', chantier: 'de chantier' } as const;
    if (s !== porteeSource) {
      throw new BadRequestException(`La source doit être une bibliothèque ${nom[porteeSource]}.`);
    }
    if (c !== porteeCible) {
      throw new BadRequestException(`La cible doit être une bibliothèque ${nom[porteeCible]}.`);
    }
  }
}
