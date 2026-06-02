/**
 * E-invoice lifecycle state machine (cahier des charges §5.6 / §7). Tracks the status of an
 * invoice through the e-invoicing flow (PPF / Chorus Pro).
 */
export type EInvoiceStatus =
  | 'issued'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'paid';

export const EINVOICE_TRANSITIONS: Record<EInvoiceStatus, EInvoiceStatus[]> = {
  issued: ['submitted'],
  submitted: ['accepted', 'rejected'],
  accepted: ['paid'],
  rejected: ['submitted'],
  paid: [],
};

export class InvalidEInvoiceTransitionError extends Error {
  constructor(
    public readonly from: EInvoiceStatus,
    public readonly to: EInvoiceStatus,
  ) {
    super(`Invalid e-invoice transition: ${from} -> ${to}`);
    this.name = 'InvalidEInvoiceTransitionError';
  }
}

export function isEInvoiceStatus(value: string): value is EInvoiceStatus {
  return value in EINVOICE_TRANSITIONS;
}

export function canTransition(from: EInvoiceStatus, to: EInvoiceStatus): boolean {
  return (EINVOICE_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: EInvoiceStatus, to: EInvoiceStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidEInvoiceTransitionError(from, to);
  }
}
