import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isTransferable,
  nextStates,
} from './devis-workflow';

describe('devis-workflow — cycle commercial (rule #7)', () => {
  it('autorise le chemin nominal : en cours → envoyé → gagné', () => {
    expect(canTransition('open', 'sent')).toBe(true);
    expect(canTransition('sent', 'won')).toBe(true);
  });

  it('permet de conclure directement depuis « en cours » (accord verbal, marché de gré à gré)', () => {
    expect(canTransition('open', 'won')).toBe(true);
    expect(canTransition('open', 'lost')).toBe(true);
  });

  it('gère la relance et la révision après envoi', () => {
    expect(canTransition('sent', 'followup')).toBe(true);
    expect(canTransition('sent', 'revision')).toBe(true);
    expect(canTransition('followup', 'won')).toBe(true);
    expect(canTransition('revision', 'sent')).toBe(true);
  });

  it('un devis perdu peut être repris (relance, révision) ou requalifié gagné', () => {
    expect(canTransition('lost', 'followup')).toBe(true);
    expect(canTransition('lost', 'won')).toBe(true);
  });

  it('refuse une transition non prévue et la signale', () => {
    expect(canTransition('won', 'sent')).toBe(false);
    expect(() => assertTransition('won', 'open')).toThrow(InvalidTransitionError);
  });

  it('« gagné » n’est pas terminal : une erreur de saisie reste corrigeable', () => {
    expect(nextStates('won')).toEqual(['lost']);
  });

  it('seul un devis gagné passe à l’acceptation de commande', () => {
    expect(isTransferable('won')).toBe(true);
    expect(isTransferable('sent')).toBe(false);
    expect(isTransferable('lost')).toBe(false);
    expect(isTransferable('open')).toBe(false);
  });
});
