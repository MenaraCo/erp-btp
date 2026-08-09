import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsIn, IsInt, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { RequiresPermission } from '../rbac/requires-permission.decorator';
import { PaymentProvider } from './payment-provider';
import { PaymentsService } from './payments.service';

class SessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  intitule!: string;

  /** En CENTIMES : jamais de flottant pour de l'argent. */
  @IsInt({ message: 'Le montant doit être exprimé en centimes, sans décimale.' })
  @IsPositive()
  montantCentimes!: number;

  @IsIn(['month', 'year'])
  periode!: 'month' | 'year';
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
  ) {}

  /** Ouvre la page de paiement et renvoie l'adresse de redirection. */
  @Post('abonnement/paiement/session')
  @RequiresPermission('subscription.manage')
  creerSession(@Body() body: SessionDto) {
    return this.payments.creerSession(body);
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
