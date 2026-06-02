import {
  evaluateMetre,
  InvalidFormulaError,
  UnknownVariableError,
} from './metre-eval';

describe('metre-eval — formules de métré', () => {
  it('évalue une formule avec variables globales', () => {
    expect(evaluateMetre('longueur * largeur', { longueur: 12, largeur: 5 }).toString()).toBe(
      '60',
    );
  });

  it('gère les expressions arithmétiques et fonctions', () => {
    expect(
      evaluateMetre('(a + b) * 2 + sqrt(c)', { a: 3, b: 2, c: 9 }).toString(),
    ).toBe('13'); // (5)*2 + 3
  });

  it('arrondit à 4 décimales', () => {
    expect(evaluateMetre('1 / 3', {}).toString()).toBe('0.3333');
  });

  it('rejette une variable inconnue', () => {
    expect(() => evaluateMetre('a * b', { a: 1 })).toThrow(UnknownVariableError);
  });

  it('rejette une formule invalide', () => {
    expect(() => evaluateMetre('1 +', {})).toThrow(InvalidFormulaError);
  });
});
