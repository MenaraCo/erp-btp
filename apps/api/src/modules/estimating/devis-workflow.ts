/**
 * Affaire workflow state machine (cahier des charges §5.3, rule #7).
 *
 * Ouverte → Étude en cours → Coefficients proposés → Coefficients validés → Envoyée
 *   → { Gagnée | Perdue | Relancée | Révision }
 *
 * Only a "won" (Gagnée) affaire is transferable downstream (phase 2). Codes are in English,
 * labels stay in French (business glossary).
 */
export type DevisStatus =
  | 'open'
  | 'sent'
  | 'won'
  | 'lost'
  | 'followup'
  | 'revision';

export const DEVIS_STATUS_LABELS: Record<DevisStatus, string> = {
  open: 'En cours',
  sent: 'Envoyé',
  won: 'Gagné',
  lost: 'Perdu',
  followup: 'Relancé',
  revision: 'Révision',
};

/**
 * Cycle commercial uniquement. Le passage à l'exécution (marché + chantier) relève de
 * l'acceptation de commande, pas d'une transition de statut.
 */
export const DEVIS_TRANSITIONS: Record<DevisStatus, DevisStatus[]> = {
  open: ['sent', 'won', 'lost'],
  sent: ['won', 'lost', 'followup', 'revision'],
  won: ['lost'],
  lost: ['followup', 'revision', 'won'],
  followup: ['sent', 'won', 'lost', 'revision'],
  revision: ['open', 'sent'],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: DevisStatus,
    public readonly to: DevisStatus,
  ) {
    super(`Invalid affaire transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function isDevisStatus(value: string): value is DevisStatus {
  return value in DEVIS_TRANSITIONS;
}

export function nextStates(from: DevisStatus): DevisStatus[] {
  return DEVIS_TRANSITIONS[from] ?? [];
}

export function canTransition(from: DevisStatus, to: DevisStatus): boolean {
  return nextStates(from).includes(to);
}

export function assertTransition(from: DevisStatus, to: DevisStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/** Only a won affaire may be transferred downstream (phase 2). */
export function isTransferable(status: DevisStatus): boolean {
  return status === 'won';
}
