import { computeSituation, SituationParams } from './situation-calc';

const params = (over: Partial<SituationParams> = {}): SituationParams => ({
  previousCumulHt: '0',
  retenueRate: '0.05',
  revisionCoefficient: '1',
  tvaRate: '0.20',
  ...over,
});

describe('situation-calc — situation à l’avancement (rule #6)', () => {
  it('première situation à 50% : montant, retenue, TVA, NAP', () => {
    const r = computeSituation(
      [{ marcheLineId: 'L1', quantite: '10', pu: '100', pctAvancement: '0.5' }],
      params(),
    );
    expect(r.cumulHt).toBe('500'); // 10*100*0.5
    expect(r.montantPeriodeHt).toBe('500');
    expect(r.tva).toBe('100'); // 20%
    expect(r.ttc).toBe('600');
    expect(r.retenueGarantie).toBe('25'); // 5%
    expect(r.nap).toBe('575'); // 600 - 25
  });

  it('situation_a_l_avancement_deduit_les_situations_anterieures', () => {
    // avancement passe à 80%, cumul 800, situation précédente avait certifié 500
    const r = computeSituation(
      [{ marcheLineId: 'L1', quantite: '10', pu: '100', pctAvancement: '0.8' }],
      params({ previousCumulHt: '500' }),
    );
    expect(r.cumulHt).toBe('800');
    expect(r.montantPeriodeHt).toBe('300'); // 800 - 500
    expect(r.ttc).toBe('360');
    expect(r.nap).toBe('345'); // 360 - 15
  });

  it('applique le coefficient de révision de prix', () => {
    const r = computeSituation(
      [{ marcheLineId: 'L1', quantite: '10', pu: '100', pctAvancement: '1' }],
      params({ revisionCoefficient: '1.05' }),
    );
    expect(r.cumulHt).toBe('1050'); // 1000 * 1.05
  });

  it('agrège plusieurs lignes de marché', () => {
    const r = computeSituation(
      [
        { marcheLineId: 'L1', quantite: '10', pu: '100', pctAvancement: '0.5' }, // 500
        { marcheLineId: 'L2', quantite: '4', pu: '250', pctAvancement: '0.25' }, // 250
      ],
      params(),
    );
    expect(r.cumulHt).toBe('750');
    expect(r.lines).toHaveLength(2);
  });
});
