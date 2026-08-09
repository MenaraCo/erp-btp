/**
 * Contrat du prestataire de paiement.
 *
 * L'application ne connaît JAMAIS Stripe directement : elle demande une page de paiement et reçoit
 * des événements. Deux raisons à cette abstraction — changer de prestataire ne doit toucher qu'une
 * implémentation, et surtout le développement comme les tests doivent tourner sans clé ni appel
 * réseau (voir `FakePaymentProvider`).
 *
 * Aucune donnée de carte ne transite ici, jamais : le client est REDIRIGÉ chez le prestataire,
 * conformément au cahier des charges.
 */

/** Ce que l'application sait de l'abonnement à facturer. */
export interface DemandePaiement {
  tenantId: string;
  /** Adresse de facturation du client — le prestataire s'en sert pour son reçu. */
  email: string;
  /** Intitulé présenté sur la page de paiement (ex. « Pack Essentiel — 5 utilisateurs »). */
  intitule: string;
  /** Montant récurrent en CENTIMES : jamais de flottant pour de l'argent. */
  montantCentimes: number;
  /** Périodicité du prélèvement. */
  periode: 'month' | 'year';
  /** Client déjà connu du prestataire, s'il l'est — évite d'en créer un second. */
  providerCustomerId?: string | null;
}

export interface SessionPaiement {
  /** Où rediriger le navigateur du client. */
  url: string;
  /** Référence de la session chez le prestataire, pour rapprocher l'événement reçu ensuite. */
  sessionId: string;
}

/** Les seuls faits qui intéressent l'application, une fois traduits du vocabulaire prestataire. */
export type TypeEvenementPaiement =
  /** Le client a payé : l'abonnement démarre ou se renouvelle. */
  | 'paiement_reussi'
  /** Le prélèvement a échoué : l'abonnement passe en impayé, sans être coupé pour autant. */
  | 'paiement_echoue'
  /** Le client a résilié chez le prestataire. */
  | 'abonnement_annule'
  /** Événement reçu mais hors de notre champ : on l'accuse sans rien faire. */
  | 'ignore';

export interface EvenementPaiement {
  /** Identifiant de l'événement CHEZ LE PRESTATAIRE — c'est la clé d'idempotence. */
  id: string;
  type: TypeEvenementPaiement;
  tenantId: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  /** Fin de la période payée, quand le prestataire la communique. */
  periodeFin: Date | null;
  /** Type brut du prestataire, conservé pour le journal et le diagnostic. */
  typeBrut: string;
}

export abstract class PaymentProvider {
  /** Crée la page de paiement et renvoie l'adresse vers laquelle rediriger. */
  abstract creerSession(demande: DemandePaiement): Promise<SessionPaiement>;

  /**
   * Vérifie la signature du webhook et traduit l'événement.
   *
   * Prend le corps BRUT : la signature porte sur les octets reçus, pas sur l'objet reparsé.
   * Lève si la signature ne correspond pas — sans cela, n'importe qui pourrait feindre un
   * paiement en appelant l'endpoint.
   */
  abstract lireEvenement(corpsBrut: Buffer, signature: string): Promise<EvenementPaiement>;
}
