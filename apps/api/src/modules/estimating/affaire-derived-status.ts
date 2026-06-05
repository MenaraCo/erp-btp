import { DevisStatus } from './devis-workflow';

/**
 * Statut d'une affaire — DÉRIVÉ de l'état de ses devis (jamais saisi à la main).
 * Une affaire ne se gagne pas en bloc : ce sont ses devis qui se gagnent/perdent.
 */
export type AffaireDerivedStatus = 'en_cours' | 'gagnee_partielle' | 'gagnee' | 'perdue';

export const AFFAIRE_DERIVED_STATUS_LABELS: Record<AffaireDerivedStatus, string> = {
  en_cours: 'En cours',
  gagnee_partielle: 'Gagnée partiellement',
  gagnee: 'Gagnée',
  perdue: 'Perdue',
};

/**
 * Règle :
 *  - tous les devis gagnés                    → gagnee
 *  - une partie gagnée (reste perdu/en cours) → gagnee_partielle
 *  - aucun gagné et tous perdus               → perdue
 *  - sinon (au moins un en cours, aucun gagné)→ en_cours
 * Affaire sans devis → en_cours.
 */
export function deriveAffaireStatus(devisStatuses: DevisStatus[]): AffaireDerivedStatus {
  const total = devisStatuses.length;
  if (total === 0) {
    return 'en_cours';
  }
  const won = devisStatuses.filter((s) => s === 'won').length;
  const lost = devisStatuses.filter((s) => s === 'lost').length;

  if (won === total) {
    return 'gagnee';
  }
  if (won > 0) {
    return 'gagnee_partielle';
  }
  if (lost === total) {
    return 'perdue';
  }
  return 'en_cours';
}
