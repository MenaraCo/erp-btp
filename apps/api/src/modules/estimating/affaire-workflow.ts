/**
 * Affaire workflow state machine (cahier des charges §5.3, rule #7).
 *
 * Ouverte → Étude en cours → Coefficients proposés → Coefficients validés → Envoyée
 *   → { Gagnée | Perdue | Relancée | Révision }
 *
 * Only a "won" (Gagnée) affaire is transferable downstream (phase 2). Codes are in English,
 * labels stay in French (business glossary).
 */
export type AffaireStatus =
  | 'open'
  | 'study'
  | 'coeffs_proposed'
  | 'coeffs_validated'
  | 'sent'
  | 'won'
  | 'lost'
  | 'followup'
  | 'revision';

export const AFFAIRE_STATUS_LABELS: Record<AffaireStatus, string> = {
  open: 'Ouverte',
  study: 'Étude en cours',
  coeffs_proposed: 'Coefficients proposés',
  coeffs_validated: 'Coefficients validés',
  sent: 'Envoyée',
  won: 'Gagnée',
  lost: 'Perdue',
  followup: 'Relancée',
  revision: 'Révision',
};

export const AFFAIRE_TRANSITIONS: Record<AffaireStatus, AffaireStatus[]> = {
  open: ['study'],
  study: ['coeffs_proposed'],
  coeffs_proposed: ['coeffs_validated', 'study'],
  coeffs_validated: ['sent', 'coeffs_proposed'],
  sent: ['won', 'lost', 'followup', 'revision'],
  won: [],
  lost: ['followup', 'revision'],
  followup: ['sent', 'revision'],
  revision: ['study'],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: AffaireStatus,
    public readonly to: AffaireStatus,
  ) {
    super(`Invalid affaire transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function isAffaireStatus(value: string): value is AffaireStatus {
  return value in AFFAIRE_TRANSITIONS;
}

export function nextStates(from: AffaireStatus): AffaireStatus[] {
  return AFFAIRE_TRANSITIONS[from] ?? [];
}

export function canTransition(from: AffaireStatus, to: AffaireStatus): boolean {
  return nextStates(from).includes(to);
}

export function assertTransition(from: AffaireStatus, to: AffaireStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/** Only a won affaire may be transferred downstream (phase 2). */
export function isTransferable(status: AffaireStatus): boolean {
  return status === 'won';
}
