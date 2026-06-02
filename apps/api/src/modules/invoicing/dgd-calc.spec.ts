import { computeDgd } from './dgd-calc';

describe('dgd-calc — décompte général définitif', () => {
  it('clôture le marché : TTC et solde = retenue libérée', () => {
    // marché+avenants 1600 réalisés à 100%, TVA 20%, retenue cumulée 80, déjà réglé NAP 1840
    const r = computeDgd({
      montantMarcheHt: '1600',
      travauxCumulHt: '1600',
      tvaRate: '0.20',
      retenueGarantieTotale: '80',
      dejaRegleNap: '1840',
    });
    expect(r.tva).toBe('320'); // 1600 * 20%
    expect(r.ttc).toBe('1920'); // 1600 + 320
    expect(r.soldeNap).toBe('80'); // 1920 - 1840 = retenue de garantie à libérer
    expect(r.retenueGarantieTotale).toBe('80');
  });
});
