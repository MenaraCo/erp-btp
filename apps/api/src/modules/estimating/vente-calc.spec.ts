import { computeFeuilleDeVente, SaleCoefficients } from './vente-calc';

const coeffs = (over: Partial<SaleCoefficients> = {}): SaleCoefficients => ({
  byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' },
  fraisCoefficient: '1',
  tvaRate: '0.20',
  ...over,
});

describe('vente-calc — feuille de vente', () => {
  it('rule #2 — déboursé -> PV par coefficients de nature, avec traçabilité', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { labor: '100', material: '200' } }],
      coeffs({ byNature: { labor: '1.5', material: '1.2', equipment: '1', subcontract: '1' } }),
    );
    // 100*1.5 + 200*1.2 = 390
    expect(res.items[0].pv).toBe('390');
    expect(res.items[0].appliedCoefficients.labor).toBe('1.5');
    expect(res.totalPvHt).toBe('390');
  });

  it('rule #3 — ventilation des frais prorata déboursé (conserve le total)', () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'A', vendable: true, debourseByNature: { material: '300' } },
        { id: 'B', vendable: true, debourseByNature: { material: '100' } },
        { id: 'FRAIS', vendable: false, debourseByNature: { material: '80' } },
      ],
      coeffs(),
    );
    const a = res.items.find((i) => i.id === 'A')!;
    const b = res.items.find((i) => i.id === 'B')!;
    expect(a.ventilatedFrais).toBe('60'); // 80 * 300/400
    expect(b.ventilatedFrais).toBe('20'); // 80 * 100/400
    expect(a.pv).toBe('360'); // 300 + 60
    expect(b.pv).toBe('120'); // 100 + 20
    expect(res.totalPvHt).toBe('480'); // total conserved (300+100+80)
  });

  it('PV forcé : honoré et tracé (forced=true), PV calculé conservé en référence', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { labor: '100' }, forcedPv: '999' }],
      coeffs({ byNature: { labor: '1.5', material: '1', equipment: '1', subcontract: '1' } }),
    );
    expect(res.items[0].forced).toBe(true);
    expect(res.items[0].pv).toBe('999');
    expect(res.items[0].pvComputed).toBe('150');
  });

  it('TVA et TTC', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '390' } }],
      coeffs({ tvaRate: '0.20' }),
    );
    expect(res.totalPvHt).toBe('390');
    expect(res.tva).toBe('78');
    expect(res.totalTtc).toBe('468');
  });
});
