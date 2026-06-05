import { computeFeuilleDeVente, SaleCoefficients } from './vente-calc';

const rate = (fg: string, ben: string) => ({ tauxFg: fg, tauxBenefice: ben });

const coeffs = (over: Partial<SaleCoefficients> = {}): SaleCoefficients => ({
  byNature: {
    labor: rate('0', '0'),
    material: rate('0', '0'),
    equipment: rate('0', '0'),
    subcontract: rate('0', '0'),
  },
  tvaRate: '0.20',
  ...over,
});

describe('vente-calc — feuille de vente', () => {
  it('rule #2 — cascade FG puis Bénéfice par nature, avec traçabilité', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { labor: '100', material: '200' } }],
      coeffs({
        byNature: {
          labor: rate('10', '15'), // 100 → 110 → 126.5
          material: rate('20', '15'), // 200 → 240 → 276
          equipment: rate('0', '0'),
          subcontract: rate('0', '0'),
        },
      }),
    );
    expect(res.items[0].revient).toBe('350'); // 110 + 240
    expect(res.items[0].pv).toBe('402.5'); // 126.5 + 276
    expect(res.items[0].appliedRates.labor).toEqual({ fg: '10', benefice: '15' });
    expect(res.totalRevient).toBe('350');
    expect(res.pvHorsFrais).toBe('402.5');
  });

  it('marge brute (PV − déboursé) ≠ marge nette (PV − prix de revient)', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '1000' } }],
      coeffs({
        byNature: {
          labor: rate('0', '0'),
          material: rate('20', '10'), // revient 1200, pv 1320
          equipment: rate('0', '0'),
          subcontract: rate('0', '0'),
        },
      }),
    );
    expect(res.items[0].debourse).toBe('1000');
    expect(res.items[0].revient).toBe('1200');
    expect(res.items[0].pv).toBe('1320');
    expect(res.items[0].margeBrute).toBe('320'); // 1320 − 1000
    expect(res.items[0].margeNette).toBe('120'); // 1320 − 1200
    expect(res.margeBrute).toBe('320');
    expect(res.margeNette).toBe('120');
  });

  it('rule #3 — ventilation des frais prorata déboursé, margée par nature (conserve le déboursé)', () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'A', vendable: true, debourseByNature: { material: '300' } },
        { id: 'B', vendable: true, debourseByNature: { material: '100' } },
        { id: 'FRAIS', vendable: false, debourseByNature: { material: '80' } },
      ],
      coeffs(), // tous coeffs à 0 → PV = déboursé ventilé
    );
    const a = res.items.find((i) => i.id === 'A')!;
    const b = res.items.find((i) => i.id === 'B')!;
    expect(a.ventilatedFrais).toBe('60'); // 80 * 300/400
    expect(b.ventilatedFrais).toBe('20'); // 80 * 100/400
    expect(a.pv).toBe('360'); // 300 + 60
    expect(b.pv).toBe('120'); // 100 + 20
    expect(res.totalDebourse).toBe('480'); // 300 + 100 + 80 conservé
    expect(res.pvHorsFrais).toBe('480');
  });

  it('frais annexes : % du PV hors frais + montant fixe', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '1000' } }],
      coeffs({
        fraisAnnexes: [
          { designation: 'Compte prorata', type: 'pct', valeur: '2' }, // 2% de 1000 = 20
          { designation: 'PGC', type: 'fixe', valeur: '50' },
        ],
      }),
    );
    expect(res.pvHorsFrais).toBe('1000');
    expect(res.fraisAnnexes).toBe('70'); // 20 + 50
    expect(res.pvDevis).toBe('1070');
    expect(res.totalPvHt).toBe('1070');
  });

  it('remise globale : % du PV devis et montant fixe', () => {
    const pct = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '1000' } }],
      coeffs({ remise: { type: 'pct', valeur: '10' } }),
    );
    expect(pct.remise).toBe('100'); // 10% de 1000
    expect(pct.totalPvHt).toBe('900');

    const fixe = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '1000' } }],
      coeffs({ remise: { type: 'fixe', valeur: '150' } }),
    );
    expect(fixe.remise).toBe('150');
    expect(fixe.totalPvHt).toBe('850');
  });

  it('PV forcé : honoré et tracé (forced=true), PV calculé conservé en référence', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { labor: '100' }, forcedPv: '999' }],
      coeffs({
        byNature: {
          labor: rate('10', '15'), // calculé = 126.5
          material: rate('0', '0'),
          equipment: rate('0', '0'),
          subcontract: rate('0', '0'),
        },
      }),
    );
    expect(res.items[0].forced).toBe(true);
    expect(res.items[0].pv).toBe('999');
    expect(res.items[0].pvComputed).toBe('126.5');
  });

  it('coefficient global réel = PV hors frais / déboursé total', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '1000' } }],
      coeffs({
        byNature: {
          labor: rate('0', '0'),
          material: rate('20', '10'), // pv 1320
          equipment: rate('0', '0'),
          subcontract: rate('0', '0'),
        },
      }),
    );
    expect(res.coeffGlobalReel).toBe('1.32');
  });

  it('options/variantes : valorisées mais exclues du total principal', () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'BASE', vendable: true, debourseByNature: { material: '1000' } },
        { id: 'OPT', vendable: true, section: 'option', debourseByNature: { material: '500' } },
        { id: 'VAR', vendable: true, section: 'variante', debourseByNature: { material: '300' } },
      ],
      coeffs({
        byNature: {
          labor: rate('0', '0'),
          material: rate('20', '0'), // ×1.2
          equipment: rate('0', '0'),
          subcontract: rate('0', '0'),
        },
      }),
    );
    // total principal = base seule : 1000 × 1.2 = 1200
    expect(res.totalPvHt).toBe('1200');
    expect(res.optionsPvHt).toBe('600'); // 500 × 1.2
    expect(res.variantesPvHt).toBe('360'); // 300 × 1.2
    // l'option/variante ne reçoit pas de ventilation et garde sa section
    expect(res.items.find((i) => i.id === 'OPT')!.section).toBe('option');
    expect(res.items.find((i) => i.id === 'VAR')!.section).toBe('variante');
    expect(res.items.find((i) => i.id === 'BASE')!.section).toBe('main');
  });

  it('TVA et TTC sur le PV net', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '390' } }],
      coeffs({ tvaRate: '0.20' }),
    );
    expect(res.totalPvHt).toBe('390');
    expect(res.tva).toBe('78');
    expect(res.totalTtc).toBe('468');
  });
});
