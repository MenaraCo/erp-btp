/**
 * Statuts métier : libellé et ton, en UN seul endroit.
 *
 * Le même statut se lisait « Envoyée » sur un écran, « Validée » sur un autre, et « validated »
 * là où personne n'avait pensé à le traduire. Un statut est une information de gestion : il doit
 * se dire pareil partout, sinon deux écrans semblent parler de deux commandes différentes.
 */

export type Ton = 'neutre' | 'succes' | 'info' | 'attention' | 'danger';

export interface Statut {
  label: string;
  ton: Ton;
}

/** Bon de commande. */
export const STATUT_COMMANDE: Record<string, Statut> = {
  draft: { label: 'Brouillon', ton: 'neutre' },
  pending_approval: { label: 'À valider', ton: 'attention' },
  validated: { label: 'Envoyée', ton: 'succes' },
  cancelled: { label: 'Annulée', ton: 'danger' },
};

/** Avancement d'une réception ou d'une facturation, déduit des quantités. */
export const STATUT_AVANCEMENT: Record<string, Statut> = {
  aucune: { label: 'À recevoir', ton: 'neutre' },
  partielle: { label: 'Partielle', ton: 'attention' },
  complete: { label: 'Soldée', ton: 'succes' },
};

/** Affaire et devis (étude de prix). */
export const STATUT_AFFAIRE: Record<string, Statut> = {
  open: { label: 'En cours', ton: 'info' },
  draft: { label: 'Brouillon', ton: 'neutre' },
  sent: { label: 'Envoyé', ton: 'info' },
  won: { label: 'Gagné', ton: 'succes' },
  lost: { label: 'Perdu', ton: 'danger' },
  abandoned: { label: 'Abandonné', ton: 'neutre' },
};

/** Décision d'un circuit de validation. */
export const STATUT_VALIDATION: Record<string, Statut> = {
  pending: { label: 'En attente', ton: 'attention' },
  approved: { label: 'Approuvée', ton: 'succes' },
  rejected: { label: 'Refusée', ton: 'danger' },
};

/**
 * Résout un statut. Un code inconnu se montre TEL QUEL plutôt que d'être masqué : mieux vaut
 * voir « archived » à l'écran et corriger la table que de croire le statut vide.
 */
export function statut(table: Record<string, Statut>, code: string | null | undefined): Statut {
  if (!code) return { label: '—', ton: 'neutre' };
  return table[code] ?? { label: code, ton: 'neutre' };
}
