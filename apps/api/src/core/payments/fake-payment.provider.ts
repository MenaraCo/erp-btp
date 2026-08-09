import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadAppConfig } from '../../config/env.config';
import {
  DemandePaiement,
  EvenementPaiement,
  PaymentProvider,
  SessionPaiement,
  TypeEvenementPaiement,
} from './payment-provider';

/**
 * Prestataire de substitution — développement et tests.
 *
 * Il n'appelle rien, ne coûte rien, et ne demande aucune clé. C'est ce qui permet à toute la
 * chaîne de paiement d'être éprouvée en local et en intégration continue : sans lui, les tests
 * dépendraient d'un service tiers, d'un réseau et d'un compte.
 *
 * Il SIGNE tout de même ses webhooks, avec le même algorithme que Stripe (HMAC-SHA256 sur le
 * corps brut). Ainsi le chemin de vérification est réellement exercé, et non contourné : un
 * appel non signé est refusé ici comme il le serait en production.
 */
@Injectable()
export class FakePaymentProvider extends PaymentProvider {
  private readonly secret = loadAppConfig().payment.webhookSecret || 'fake-webhook-secret';

  /** Signature qu'un test (ou l'outil de développement) doit produire pour être accepté. */
  static signer(corpsBrut: Buffer, secret = 'fake-webhook-secret'): string {
    return createHmac('sha256', secret).update(corpsBrut).digest('hex');
  }

  async creerSession(demande: DemandePaiement): Promise<SessionPaiement> {
    const sessionId = `fake_sess_${demande.tenantId.slice(0, 8)}_${demande.montantCentimes}`;
    const { successUrl } = loadAppConfig().payment;
    // On renvoie directement vers l'URL de retour : en développement, « payer » revient à
    // revenir sur l'écran d'abonnement. Le changement d'état, lui, viendra du webhook — comme
    // en production, pour que le parcours éprouvé soit le vrai.
    return { url: `${successUrl}&session=${sessionId}`, sessionId };
  }

  async lireEvenement(corpsBrut: Buffer, signature: string): Promise<EvenementPaiement> {
    const attendue = createHmac('sha256', this.secret).update(corpsBrut).digest('hex');
    const a = Buffer.from(attendue);
    const b = Buffer.from(signature ?? '');
    // Comparaison à temps constant : une comparaison naïve laisse deviner la signature octet
    // par octet en mesurant le temps de réponse.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Signature du webhook invalide.');
    }

    const brut = JSON.parse(corpsBrut.toString('utf8')) as {
      id?: string;
      type?: string;
      tenantId?: string;
      providerCustomerId?: string;
      providerSubscriptionId?: string;
      periodeFin?: string;
    };
    const types: Record<string, TypeEvenementPaiement> = {
      paiement_reussi: 'paiement_reussi',
      paiement_echoue: 'paiement_echoue',
      abonnement_annule: 'abonnement_annule',
    };
    return {
      id: brut.id ?? 'fake_evt_sans_id',
      type: types[brut.type ?? ''] ?? 'ignore',
      tenantId: brut.tenantId ?? null,
      providerCustomerId: brut.providerCustomerId ?? null,
      providerSubscriptionId: brut.providerSubscriptionId ?? null,
      periodeFin: brut.periodeFin ? new Date(brut.periodeFin) : null,
      typeBrut: brut.type ?? 'inconnu',
    };
  }
}
