import { natureResult } from './analytics-calc';

describe('analytics-calc — résultat par nature', () => {
  it('calcule l’écart = budget objectif − (réalisé + engagé)', () => {
    const r = natureResult({
      nature: 'material',
      budgetObjectif: '1000',
      budgetPrevisionnel: '1000',
      engage: '300',
      realise: '500',
    });
    expect(r.ecart).toBe('200.00'); // 1000 - (500 + 300)
  });

  it('écart négatif signale une dérive', () => {
    const r = natureResult({
      nature: 'labor',
      budgetObjectif: '800',
      budgetPrevisionnel: '900',
      engage: '0',
      realise: '950',
    });
    expect(r.ecart).toBe('-150.00'); // 800 - 950
  });
});
