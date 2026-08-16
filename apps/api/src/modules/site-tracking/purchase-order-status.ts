/**
 * Purchase order (bon de commande) state machine (cahier des charges §5.5 / §5.8).
 * ENGAGÉ is counted as soon as the order is `validated` (not at invoicing). A cancelled order
 * no longer counts.
 */
export type PurchaseOrderStatus = 'draft' | 'pending_approval' | 'validated' | 'cancelled';

/**
 * `pending_approval` : la commande dépasse un seuil et attend ses validateurs. Elle n'engage RIEN
 * tant qu'elle n'est pas validée — sinon un simple envoi au visa gonflerait l'engagé du chantier.
 * Un refus la renvoie en brouillon : on corrige et on resoumet.
 */
export const PO_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  draft: ['pending_approval', 'validated', 'cancelled'],
  pending_approval: ['validated', 'draft', 'cancelled'],
  validated: ['cancelled'],
  cancelled: [],
};

export class InvalidPoTransitionError extends Error {
  constructor(
    public readonly from: PurchaseOrderStatus,
    public readonly to: PurchaseOrderStatus,
  ) {
    super(`Invalid purchase order transition: ${from} -> ${to}`);
    this.name = 'InvalidPoTransitionError';
  }
}

export function canTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return (PO_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidPoTransitionError(from, to);
  }
}

/** A validated (non-cancelled) order contributes to the engagé. */
export function isEngaged(status: PurchaseOrderStatus): boolean {
  return status === 'validated';
}
