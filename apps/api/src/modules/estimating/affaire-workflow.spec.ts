import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isTransferable,
  nextStates,
} from './affaire-workflow';

describe('affaire-workflow — machine à états (rule #7)', () => {
  it('autorise le chemin nominal jusqu’à Gagnée', () => {
    expect(canTransition('open', 'study')).toBe(true);
    expect(canTransition('study', 'coeffs_proposed')).toBe(true);
    expect(canTransition('coeffs_proposed', 'coeffs_validated')).toBe(true);
    expect(canTransition('coeffs_validated', 'sent')).toBe(true);
    expect(canTransition('sent', 'won')).toBe(true);
  });

  it('refuse une transition non autorisée', () => {
    expect(canTransition('open', 'won')).toBe(false);
    expect(canTransition('open', 'sent')).toBe(false);
    expect(() => assertTransition('open', 'won')).toThrow(InvalidTransitionError);
  });

  it('Gagnée est terminal', () => {
    expect(nextStates('won')).toEqual([]);
  });

  it('seule une affaire Gagnée est transférable', () => {
    expect(isTransferable('won')).toBe(true);
    expect(isTransferable('sent')).toBe(false);
    expect(isTransferable('lost')).toBe(false);
  });

  it('permet le retour en arrière étude depuis coefficients proposés', () => {
    expect(canTransition('coeffs_proposed', 'study')).toBe(true);
  });
});
