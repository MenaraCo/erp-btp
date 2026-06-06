import { computeApproLine } from './appro-calc';

describe('appro-calc — conversion emploi → achat', () => {
  it('convertit la quantité d’emploi en quantité d’achat (coeff)', () => {
    // 100 sacs, 1 palette = 40 sacs → 2.5 palettes
    const r = computeApproLine({ qteEmploi: '100', coeffConversion: '40', prixPublic: '120', puDebours: '3' });
    expect(r.qteAppro).toBe('2.5');
    expect(r.montant).toBe('300'); // 2.5 × 120 (prix catalogue par palette)
  });

  it('coeff 1 → quantité d’achat = quantité d’emploi', () => {
    const r = computeApproLine({ qteEmploi: '12', coeffConversion: '1', prixPublic: null, puDebours: '40' });
    expect(r.qteAppro).toBe('12');
    expect(r.montant).toBe('480'); // 12 × 40 (déboursé, pas de prix catalogue)
  });

  it('coeff nul → pas de conversion, montant au déboursé', () => {
    const r = computeApproLine({ qteEmploi: '5', coeffConversion: '0', prixPublic: null, puDebours: '10' });
    expect(r.qteAppro).toBe('5');
    expect(r.montant).toBe('50');
  });
});
