import { computeIndicators, FormulaInputs } from './financial-formulas';

/**
 * Pure predictive cost-control engine (cahier des charges §5.8, rule #9). Every formula is
 * pinned with known values. Parameters (EAC method, alert thresholds) come from the versioned
 * formula set; the algorithms here are fixed and tested.
 */
const BASE: FormulaInputs = {
  vente: '15000',
  budget: '10000', // budget objectif = "budget initial"
  previsionnel: '10000',
  engage: '4000',
  realise: '3000',
  avancement: '0.4',
  eacMethod: 'm2',
  ecartAlertPct: '-0.05',
  margeCiblePct: '0.05',
};

describe('computeIndicators — indicateurs prédictifs (§5.8)', () => {
  it('budget avancé = budget × avancement', () => {
    expect(computeIndicators(BASE).budgetAvance).toBe('4000.00');
  });

  it('écart au stade = budget avancé − (réalisé + engagé)', () => {
    // 4000 − (3000 + 4000) = -3000
    expect(computeIndicators(BASE).ecartAuStade).toBe('-3000.00');
  });

  it('reste à engager = budget − engagé ; reste à dépenser = prévisionnel − réalisé', () => {
    const r = computeIndicators(BASE);
    expect(r.resteAEngager).toBe('6000.00');
    expect(r.resteADepenser).toBe('7000.00');
  });

  it('CPI = budget avancé / réalisé', () => {
    // 4000 / 3000 = 1.3333
    expect(computeIndicators(BASE).cpi).toBe('1.3333');
  });

  it('EAC méthode m2 = budget / CPI (= réalisé / avancement)', () => {
    // 10000 / 1.3333… = 7500
    expect(computeIndicators(BASE).eac).toBe('7500.00');
  });

  it('EAC méthode m1 = réalisé + reste à dépenser (= prévisionnel)', () => {
    expect(computeIndicators({ ...BASE, eacMethod: 'm1' }).eac).toBe('10000.00');
  });

  it('marge prévisionnelle = vente − EAC, en € et en %', () => {
    const r = computeIndicators(BASE); // EAC m2 = 7500
    expect(r.margePrevisionnelle).toBe('7500.00');
    expect(r.margePrevisionnellePct).toBe('0.5000'); // 7500 / 15000
  });

  it('lève une alerte d’écart quand écart/budget < seuil', () => {
    const r = computeIndicators(BASE); // écart pct = -3000/10000 = -0.30 < -0.05
    expect(r.alerts).toContain('ecart');
  });

  it('lève une alerte de marge quand marge % < cible', () => {
    // marge faible : EAC proche de la vente. vente=10000, réalisé=9500, av=0.95 → EAC m2≈10000
    const r = computeIndicators({
      ...BASE,
      vente: '10000',
      budget: '10000',
      realise: '9500',
      avancement: '0.95',
      engage: '9500',
    });
    expect(Number(r.margePrevisionnellePct)).toBeLessThan(0.05);
    expect(r.alerts).toContain('marge');
  });

  it('gère avancement = 0 (CPI/EAC m2 indéfinis → null, pas de division par zéro)', () => {
    const r = computeIndicators({ ...BASE, avancement: '0', realise: '0' });
    expect(r.budgetAvance).toBe('0.00');
    expect(r.cpi).toBeNull();
    expect(r.eac).toBeNull(); // m2 indéfini sans avancement
  });

  it('marge en % = null si vente nulle (pas de division par zéro)', () => {
    const r = computeIndicators({ ...BASE, vente: '0' });
    expect(r.margePrevisionnellePct).toBeNull();
  });
});
