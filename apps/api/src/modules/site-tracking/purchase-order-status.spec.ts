import {
  assertTransition,
  canTransition,
  InvalidPoTransitionError,
  isEngaged,
} from './purchase-order-status';

describe('purchase-order-status — bon de commande', () => {
  it('autorise draft -> validated -> cancelled', () => {
    expect(canTransition('draft', 'validated')).toBe(true);
    expect(canTransition('validated', 'cancelled')).toBe(true);
    expect(canTransition('draft', 'cancelled')).toBe(true);
  });

  it('refuse une transition invalide (cancelled terminal)', () => {
    expect(canTransition('cancelled', 'validated')).toBe(false);
    expect(() => assertTransition('cancelled', 'validated')).toThrow(InvalidPoTransitionError);
  });

  it('seul un BC validé compte dans l’engagé', () => {
    expect(isEngaged('validated')).toBe(true);
    expect(isEngaged('draft')).toBe(false);
    expect(isEngaged('cancelled')).toBe(false);
  });
});
