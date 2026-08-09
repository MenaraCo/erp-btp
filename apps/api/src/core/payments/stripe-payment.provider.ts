import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import Stripe from 'stripe';
import { loadAppConfig } from '../../config/env.config';
import {
  DemandePaiement,
  EvenementPaiement,
  PaymentProvider,
  SessionPaiement,
  TypeEvenementPaiement,
} from './payment-provider';

/**
 * Implémentation Stripe — abonnement RÉCURRENT par redirection.
 *
 * Aucune donnée de carte ne touche l'application : on crée une session Checkout et on renvoie le
 * navigateur chez Stripe. Ce qui revient ensuite passe par le webhook, seul canal digne de
 * confiance — la page de retour du client peut être fermée, rechargée ou falsifiée, l'événement
 * signé ne le peut pas.
 *
 * `tenantId` voyage en métadonnée : c'est ce qui permet de rattacher un événement à la bonne
 * société sans dépendre d'un rapprochement fragile sur l'e-mail.
 */
@Injectable()
export class StripePaymentProvider extends PaymentProvider {
  private readonly logger = new Logger(StripePaymentProvider.name);
  private readonly conf = loadAppConfig().payment;
  private readonly stripe = new Stripe(this.conf.secretKey);

  async creerSession(demande: DemandePaiement): Promise<SessionPaiement> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: demande.providerCustomerId ?? undefined,
      customer_email: demande.providerCustomerId ? undefined : demande.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: demande.montantCentimes,
            recurring: { interval: demande.periode },
            product_data: { name: demande.intitule },
          },
        },
      ],
      success_url: this.conf.successUrl,
      cancel_url: this.conf.cancelUrl,
      // Reportée sur l'abonnement créé : les événements de renouvellement la porteront aussi.
      metadata: { tenantId: demande.tenantId },
      subscription_data: { metadata: { tenantId: demande.tenantId } },
    });
    if (!session.url) {
      throw new Error('Stripe n’a pas renvoyé d’adresse de paiement.');
    }
    return { url: session.url, sessionId: session.id };
  }

  async lireEvenement(corpsBrut: Buffer, signature: string): Promise<EvenementPaiement> {
    let evt: Stripe.Event;
    try {
      // Porte sur les OCTETS reçus : un corps reparsé puis re-sérialisé ne vérifierait plus.
      evt = this.stripe.webhooks.constructEvent(corpsBrut, signature, this.conf.webhookSecret);
    } catch (e) {
      this.logger.warn(`Webhook refusé : ${e instanceof Error ? e.message : 'signature invalide'}`);
      throw new UnauthorizedException('Signature du webhook invalide.');
    }

    const type: TypeEvenementPaiement =
      evt.type === 'checkout.session.completed' || evt.type === 'invoice.paid'
        ? 'paiement_reussi'
        : evt.type === 'invoice.payment_failed'
          ? 'paiement_echoue'
          : evt.type === 'customer.subscription.deleted'
            ? 'abonnement_annule'
            : 'ignore';

    const objet = evt.data.object as unknown as Record<string, unknown>;
    const meta = (objet.metadata ?? {}) as Record<string, string>;
    const finPeriode = objet.current_period_end ?? objet.period_end;

    return {
      id: evt.id,
      type,
      tenantId: meta.tenantId ?? null,
      providerCustomerId: (objet.customer as string | null) ?? null,
      providerSubscriptionId:
        (objet.subscription as string | null) ??
        (evt.type.startsWith('customer.subscription') ? (objet.id as string) : null),
      // Stripe compte en secondes ; JavaScript en millisecondes.
      periodeFin: typeof finPeriode === 'number' ? new Date(finPeriode * 1000) : null,
      typeBrut: evt.type,
    };
  }
}
