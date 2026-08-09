import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsIn } from 'class-validator';
import { RequiresPermission } from '../rbac/requires-permission.decorator';
import { TenantContext } from '../tenancy/tenant-context';
import { PaymentProvider } from './payment-provider';
import { PaymentsService } from './payments.service';

/** Banc d'essai uniquement : l'événement que l'on demande au faux prestataire d'émettre. */
class SimulationDto {
  @IsIn(['paiement_reussi', 'paiement_echoue', 'abonnement_annule'])
  type!: 'paiement_reussi' | 'paiement_echoue' | 'abonnement_annule';
}

/**
 * Paiement des abonnements.
 *
 * Deux routes de natures opposées : l'ouverture de la page de paiement, réservée à qui gère
 * l'abonnement de sa société ; et le webhook, PUBLIC par nécessité — le prestataire n'a ni
 * compte ni jeton chez nous. Ce dernier n'est donc protégé que par la SIGNATURE de son contenu,
 * ce qui suffit : sans le secret partagé, on ne peut pas fabriquer d'événement crédible.
 */
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly provider: PaymentProvider,
    private readonly context: TenantContext,
  ) {}

  /**
   * Ce qui sera prélevé, et comment le paiement fonctionne ici. L'écran d'abonnement l'affiche
   * avant tout clic : personne ne doit découvrir un montant après avoir été redirigé.
   */
  @Get('abonnement/paiement/devis')
  @RequiresPermission('subscription.manage')
  async devis() {
    const fictif = this.payments.estFictif();
    try {
      return { fictif, devis: await this.payments.calculerDevis(this.context.requireTenantId()), motif: null };
    } catch (e) {
      // Consulter ce qu'on doit payer ne peut pas « échouer » : quand il n'y a rien à prélever,
      // l'écran a besoin de la RAISON pour la dire, pas d'une erreur à afficher en rouge.
      if (e instanceof BadRequestException) {
        return { fictif, devis: null, motif: (e.getResponse() as { message?: string }).message ?? e.message };
      }
      throw e;
    }
  }

  /**
   * Ouvre la page de paiement et renvoie l'adresse de redirection.
   *
   * Aucun montant n'est accepté du navigateur : il est recalculé depuis la souscription.
   */
  @Post('abonnement/paiement/session')
  @RequiresPermission('subscription.manage')
  creerSession() {
    return this.payments.creerSession();
  }

  /**
   * Banc d'essai — émet l'événement qu'enverrait le prestataire. N'existe qu'avec le prestataire
   * de substitution et hors production ; le service refuse dans tous les autres cas.
   */
  @Post('abonnement/paiement/simuler')
  @RequiresPermission('subscription.manage')
  simuler(@Body() body: SimulationDto) {
    return this.payments.simuler(body.type);
  }

  /**
   * Retour du prestataire. Aucune garde applicative : c'est la signature qui authentifie.
   *
   * Le corps BRUT est indispensable — la signature porte sur les octets reçus. Un corps reparsé
   * puis re-sérialisé ne correspondrait plus, et tout paiement légitime serait refusé.
   *
   * Renvoie toujours 2xx dès lors que l'événement a été enregistré, y compris s'il était déjà
   * connu : un prestataire qui reçoit une erreur réessaie en boucle.
   */
  @Post('webhooks/paiement')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signatureStripe?: string,
    @Headers('x-signature') signatureFake?: string,
  ) {
    const corpsBrut = req.rawBody;
    if (!corpsBrut) {
      // Sans corps brut, la vérification est impossible : mieux vaut refuser que faire semblant.
      throw new BadRequestException('Corps brut absent : vérification de signature impossible.');
    }
    const evt = await this.provider.lireEvenement(corpsBrut, signatureStripe ?? signatureFake ?? '');
    const { applique } = await this.payments.appliquer(evt, safeParse(corpsBrut));
    return { recu: true, type: evt.type, applique };
  }
}

/** Le journal conserve le corps ; un contenu illisible ne doit pas faire échouer le traitement. */
function safeParse(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return { brut: buf.toString('utf8').slice(0, 2000) };
  }
}
