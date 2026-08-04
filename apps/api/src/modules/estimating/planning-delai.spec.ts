import { compterPlanning, evaluerDelai } from './planning-delai';

/**
 * Tenue des délais d'étude : tant que rien n'est remis, le verdict se lit par rapport à
 * aujourd'hui ; une fois l'offre remise, il se fige sur la date de retour.
 */
const AUJ = '2026-07-10';

describe('planning-delai — tenue des délais de remise', () => {
  it('compte l’avance en jours quand l’échéance est devant', () => {
    const d = evaluerDelai('2026-07-15', null, AUJ);
    expect(d.etat).toBe('avance');
    expect(d.jours).toBe(5);
    expect(d.rendu).toBe(false);
  });

  it('déclare le retard dès que l’échéance est passée, même sans remise', () => {
    const d = evaluerDelai('2026-07-01', null, AUJ);
    expect(d.etat).toBe('depasse');
    expect(d.jours).toBe(-9);
  });

  it('le jour de l’échéance, on est à l’heure — pas en retard', () => {
    expect(evaluerDelai('2026-07-10', null, AUJ).etat).toBe('a_lheure');
    expect(evaluerDelai('2026-07-10', null, AUJ).jours).toBe(0);
  });

  it('une fois l’offre remise, le verdict se fige sur la date de retour', () => {
    // Remise le 8 pour une échéance au 15 : 7 jours d'avance, et l'écoulement du temps n'y
    // change plus rien.
    const d = evaluerDelai('2026-07-15', '2026-07-08', '2026-09-30');
    expect(d.etat).toBe('avance');
    expect(d.jours).toBe(7);
    expect(d.rendu).toBe(true);
  });

  it('un retard constaté ne s’efface pas', () => {
    const d = evaluerDelai('2026-07-01', '2026-07-05', AUJ);
    expect(d.etat).toBe('depasse');
    expect(d.jours).toBe(-4);
    expect(d.rendu).toBe(true);
  });

  it('sans échéance, il n’y a pas de délai à tenir', () => {
    const d = evaluerDelai(null, null, AUJ);
    expect(d.etat).toBe('sans_echeance');
    expect(d.jours).toBeNull();
  });

  it('compte les en-têtes sur la même règle que les badges', () => {
    const n = compterPlanning(
      [
        { dateLimite: '2026-07-01' },                              // dépassée, en cours
        { dateLimite: '2026-07-20' },                              // en avance, en cours
        { dateLimite: '2026-07-05', dateRetour: '2026-07-04' },    // rendue à temps
        { dateLimite: '2026-06-30', dateRetour: '2026-07-02', close: true }, // rendue en retard, close
        { dateLimite: null },                                      // sans échéance
      ],
      AUJ,
    );
    expect(n.enCours).toBe(4); // toutes sauf la close
    expect(n.rendues).toBe(2);
    expect(n.depassees).toBe(2); // celle en cours + celle rendue en retard
    expect(n.sansEcheance).toBe(1);
  });
});
