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

  /* ─────────── B.1 — types de sous-traitance (définis par devis) ─────────── */

  it("B.1 — chaque type de sous-traitance applique SES propres FG et bénéfice", () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'A', vendable: true, debourseBySt: { moyens: '1000' } },
        { id: 'B', vendable: true, debourseBySt: { competence: '1000' } },
      ],
      coeffs({
        stRates: {
          moyens: rate('10', '5'), // 1000 → 1100 → 1155
          competence: rate('20', '10'), // 1000 → 1200 → 1320
        },
      }),
    );
    expect(res.items.find((i) => i.id === 'A')!.revient).toBe('1100');
    expect(res.items.find((i) => i.id === 'A')!.pv).toBe('1155');
    expect(res.items.find((i) => i.id === 'B')!.revient).toBe('1200');
    expect(res.items.find((i) => i.id === 'B')!.pv).toBe('1320');
    expect(res.pvHorsFrais).toBe('2475');
  });

  it("B.1 — une ligne ST sans type retombe sur les taux de la nature « sous-traitance »", () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { subcontract: '1000' } }],
      coeffs({
        byNature: {
          labor: rate('0', '0'), material: rate('0', '0'), equipment: rate('0', '0'),
          subcontract: rate('30', '0'), // 1000 → 1300
        },
        stRates: { moyens: rate('10', '5') },
      }),
    );
    expect(res.items[0].revient).toBe('1300');
    expect(res.items[0].pv).toBe('1300');
  });

  it("B.1 — un type inconnu retombe sur les taux « sous-traitance » (pas de perte de déboursé)", () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseBySt: { inexistant: '500' } }],
      coeffs({
        byNature: {
          labor: rate('0', '0'), material: rate('0', '0'), equipment: rate('0', '0'),
          subcontract: rate('10', '0'),
        },
        stRates: { moyens: rate('50', '50') },
      }),
    );
    expect(res.items[0].debourse).toBe('500');
    expect(res.items[0].revient).toBe('550');
  });

  it("B.1 — la ventilation des frais garde le type de ST (marge au bon taux)", () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'FRAIS', vendable: false, debourseBySt: { moyens: '100' } },
        { id: 'A', vendable: true, debourseBySt: { moyens: '900' } },
      ],
      coeffs({ stRates: { moyens: rate('0', '10') } }),
    );
    // tout le déboursé (900 + 100 ventilés) est margé au taux « moyens »
    expect(res.items.find((i) => i.id === 'A')!.debourse).toBe('1000');
    expect(res.items.find((i) => i.id === 'A')!.ventilatedFrais).toBe('100');
    expect(res.items.find((i) => i.id === 'A')!.pv).toBe('1100');
    expect(res.totalDebourse).toBe('1000'); // la ventilation conserve le déboursé
  });

  it("B.1 — le récapitulatif par nature agrège les types de ST (compatibilité déboursé)", () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '200', subcontract: '50' }, debourseBySt: { moyens: '300', competence: '150' } }],
      coeffs({ stRates: { moyens: rate('0', '0'), competence: rate('0', '0') } }),
    );
    expect(res.items[0].debourseByNature.subcontract).toBe('500'); // 50 + 300 + 150
    expect(res.items[0].debourseByNature.material).toBe('200');
    expect(res.items[0].debourseBySt!.moyens).toBe('300');
    expect(res.items[0].debourseBySt!.competence).toBe('150');
  });

  /* ─────────── B.2 — frais ventilés Part Propre / Sous-traitance ─────────── */

  it("B.2 — frais « part propre » : répartis sur la part propre uniquement", () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'FRAIS', vendable: false, ventilationBase: 'propre', debourseByNature: { material: '100' } },
        { id: 'PROPRE', vendable: true, debourseByNature: { labor: '400' } },
        { id: 'ST', vendable: true, debourseByNature: { subcontract: '600' } },
      ],
      coeffs(),
    );
    // 100 % des frais vont sur la ligne « part propre », rien sur la sous-traitance
    expect(res.items.find((i) => i.id === 'PROPRE')!.ventilatedFrais).toBe('100');
    expect(res.items.find((i) => i.id === 'ST')!.ventilatedFrais).toBe('0');
    expect(res.totalDebourse).toBe('1100'); // la ventilation conserve le déboursé
  });

  it("B.2 — frais « sous-traitance » : répartis sur la ST uniquement", () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'FRAIS', vendable: false, ventilationBase: 'st', debourseByNature: { material: '90' } },
        { id: 'PROPRE', vendable: true, debourseByNature: { labor: '400' } },
        { id: 'ST', vendable: true, debourseBySt: { moyens: '600' } },
      ],
      coeffs({ stRates: { moyens: rate('0', '0') } }),
    );
    expect(res.items.find((i) => i.id === 'ST')!.ventilatedFrais).toBe('90');
    expect(res.items.find((i) => i.id === 'PROPRE')!.ventilatedFrais).toBe('0');
    expect(res.totalDebourse).toBe('1090');
  });

  it("B.2 — répartition PRORATA à l'intérieur de la base choisie", () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'FRAIS', vendable: false, ventilationBase: 'propre', debourseByNature: { material: '300' } },
        { id: 'A', vendable: true, debourseByNature: { labor: '100' } },
        { id: 'B', vendable: true, debourseByNature: { material: '200' } },
        { id: 'ST', vendable: true, debourseByNature: { subcontract: '900' } },
      ],
      coeffs(),
    );
    // 300 répartis sur 300 de part propre : 1/3 pour A, 2/3 pour B
    expect(res.items.find((i) => i.id === 'A')!.ventilatedFrais).toBe('100');
    expect(res.items.find((i) => i.id === 'B')!.ventilatedFrais).toBe('200');
    expect(res.items.find((i) => i.id === 'ST')!.ventilatedFrais).toBe('0');
  });

  it("B.2 — sans clé précisée : comportement historique (prorata du déboursé total)", () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'FRAIS', vendable: false, debourseByNature: { material: '100' } },
        { id: 'PROPRE', vendable: true, debourseByNature: { labor: '400' } },
        { id: 'ST', vendable: true, debourseByNature: { subcontract: '600' } },
      ],
      coeffs(),
    );
    expect(res.items.find((i) => i.id === 'PROPRE')!.ventilatedFrais).toBe('40');
    expect(res.items.find((i) => i.id === 'ST')!.ventilatedFrais).toBe('60');
  });

  it("B.2 — base absente : repli sur le déboursé total (aucun frais perdu)", () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'FRAIS', vendable: false, ventilationBase: 'st', debourseByNature: { material: '50' } },
        { id: 'PROPRE', vendable: true, debourseByNature: { labor: '450' } },
      ],
      coeffs(),
    );
    // aucune sous-traitance vendable : les frais retombent sur l'ensemble
    expect(res.items.find((i) => i.id === 'PROPRE')!.ventilatedFrais).toBe('50');
    expect(res.totalDebourse).toBe('500');
  });

  /* ─────────── B.3 — arrondis et PV imposé global ─────────── */

  it("B.3 — arrondi du PV de ligne au pas choisi (proche / supérieur / inférieur)", () => {
    const run = (pas: string, mode: 'proche' | 'sup' | 'inf') =>
      computeFeuilleDeVente(
        [{ id: 'A', vendable: true, debourseByNature: { material: '1234.56' } }],
        coeffs({ arrondi: { pas, mode } }),
      ).items[0].pv;
    expect(run('10', 'proche')).toBe('1230');
    expect(run('10', 'sup')).toBe('1240');
    expect(run('10', 'inf')).toBe('1230');
    expect(run('1', 'proche')).toBe('1235');
    expect(run('5', 'sup')).toBe('1235');
  });

  it("B.3 — sans arrondi paramétré, le PV garde ses centimes", () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '1234.56' } }],
      coeffs(),
    );
    expect(res.items[0].pv).toBe('1234.56');
  });

  it("B.3 — PV imposé global : les lignes sont ajustées au prorata", () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'A', vendable: true, debourseByNature: { material: '400' } },
        { id: 'B', vendable: true, debourseByNature: { material: '600' } },
      ],
      coeffs({ pvImpose: '1200' }),
    );
    expect(res.pvHorsFrais).toBe('1200');
    expect(res.items.find((i) => i.id === 'A')!.pv).toBe('480'); // 400 × 1.2
    expect(res.items.find((i) => i.id === 'B')!.pv).toBe('720'); // 600 × 1.2
    expect(res.pvImposeApplied).toBe(true);
    expect(res.coeffAjustement).toBe('1.2');
  });

  it("B.3 — PV imposé : une ligne au PV forcé n'est pas réajustée, le reste absorbe", () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'FORCE', vendable: true, debourseByNature: { material: '400' }, forcedPv: '500' },
        { id: 'LIBRE', vendable: true, debourseByNature: { material: '600' } },
      ],
      coeffs({ pvImpose: '1200' }),
    );
    // la ligne forcée garde 500 ; les 700 restants vont sur la ligne libre
    expect(res.items.find((i) => i.id === 'FORCE')!.pv).toBe('500');
    expect(res.items.find((i) => i.id === 'LIBRE')!.pv).toBe('700');
    expect(res.pvHorsFrais).toBe('1200');
  });

  it("B.3 — PV imposé : le déboursé et le prix de revient ne bougent pas, la marge s'ajuste", () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '1000' } }],
      coeffs({
        byNature: {
          labor: rate('0', '0'), material: rate('10', '0'), equipment: rate('0', '0'),
          subcontract: rate('0', '0'),
        },
        pvImpose: '1500',
      }),
    );
    expect(res.totalDebourse).toBe('1000');
    expect(res.totalRevient).toBe('1100');
    expect(res.items[0].pv).toBe('1500');
    expect(res.items[0].margeBrute).toBe('500'); // 1500 − 1000
    expect(res.items[0].margeNette).toBe('400'); // 1500 − 1100
  });

  /* ─────────── E.2 — frais annexes : à part ou noyés dans les prix unitaires ─────────── */

  it("E.2 — mode « séparé » (défaut) : les frais s'ajoutent après les lignes", () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'A', vendable: true, debourseByNature: { material: '400' } },
        { id: 'B', vendable: true, debourseByNature: { material: '600' } },
      ],
      coeffs({ fraisAnnexes: [{ designation: 'Prorata', type: 'pct', valeur: '10' }] }),
    );
    expect(res.pvHorsFrais).toBe('1000');
    expect(res.fraisAnnexes).toBe('100');
    expect(res.pvDevis).toBe('1100');
    expect(res.items.find((i) => i.id === 'A')!.pv).toBe('400'); // PU de ligne inchangé
  });

  it("E.2 — mode « noyé » : les frais sont répartis dans les PV de ligne, au prorata", () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'A', vendable: true, debourseByNature: { material: '400' } },
        { id: 'B', vendable: true, debourseByNature: { material: '600' } },
      ],
      coeffs({
        fraisAnnexes: [{ designation: 'Prorata', type: 'pct', valeur: '10' }],
        fraisMode: 'inclus',
      }),
    );
    // 100 € de frais dilués : A 400→440, B 600→660
    expect(res.items.find((i) => i.id === 'A')!.pv).toBe('440');
    expect(res.items.find((i) => i.id === 'B')!.pv).toBe('660');
    // plus de poste de frais séparé, mais le total est identique
    expect(res.fraisAnnexes).toBe('0');
    expect(res.fraisAnnexesIntegres).toBe('100');
    expect(res.pvDevis).toBe('1100');
    expect(res.totalPvHt).toBe('1100');
  });

  it("E.2 — noyés : le total HT est identique aux deux modes", () => {
    const items = [
      { id: 'A', vendable: true, debourseByNature: { material: '700' } },
      { id: 'B', vendable: true, debourseByNature: { material: '300' } },
    ];
    const frais = [{ designation: 'Installation', type: 'fixe' as const, valeur: '250' }];
    const sep = computeFeuilleDeVente(items, coeffs({ fraisAnnexes: frais }));
    const inc = computeFeuilleDeVente(items, coeffs({ fraisAnnexes: frais, fraisMode: 'inclus' }));
    expect(inc.totalPvHt).toBe(sep.totalPvHt);
    expect(inc.totalTtc).toBe(sep.totalTtc);
  });

  it("E.2 — noyés : une ligne au PV forcé garde son prix, les autres absorbent les frais", () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'FORCE', vendable: true, debourseByNature: { material: '400' }, forcedPv: '400' },
        { id: 'LIBRE', vendable: true, debourseByNature: { material: '600' } },
      ],
      coeffs({
        fraisAnnexes: [{ designation: 'Prorata', type: 'fixe', valeur: '60' }],
        fraisMode: 'inclus',
      }),
    );
    expect(res.items.find((i) => i.id === 'FORCE')!.pv).toBe('400');
    expect(res.items.find((i) => i.id === 'LIBRE')!.pv).toBe('660');
    expect(res.totalPvHt).toBe('1060');
  });

  /* ─────────── E.3 — mode par POSTE de frais + intitulés conservés ─────────── */

  it("E.3 — chaque poste a son propre mode : l'un noyé, l'autre séparé", () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '1000' } }],
      coeffs({
        fraisAnnexes: [
          { designation: 'Compte prorata', type: 'pct', valeur: '5', mode: 'inclus' },
          { designation: 'Installation de chantier', type: 'fixe', valeur: '300', mode: 'separe' },
        ],
      }),
    );
    // le prorata (50) est dilué dans la ligne, l'installation reste un poste visible
    expect(res.items[0].pv).toBe('1050');
    expect(res.fraisAnnexesIntegres).toBe('50');
    expect(res.fraisAnnexes).toBe('300');
    expect(res.pvDevis).toBe('1350');
  });

  it("E.3 — les postes séparés sont détaillés un par un, avec leur intitulé", () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '1000' } }],
      coeffs({
        fraisAnnexes: [
          { designation: 'Compte prorata', type: 'pct', valeur: '2', mode: 'separe' },
          { designation: 'Nettoyage', type: 'fixe', valeur: '150', mode: 'separe' },
          { designation: 'Panneau de chantier', type: 'fixe', valeur: '80', mode: 'separe' },
        ],
      }),
    );
    expect(res.fraisDetail).toEqual([
      { designation: 'Compte prorata', montant: '20' },
      { designation: 'Nettoyage', montant: '150' },
      { designation: 'Panneau de chantier', montant: '80' },
    ]);
    expect(res.fraisAnnexes).toBe('250'); // 20 + 150 + 80, jamais regroupés à l'affichage
  });

  it("E.3 — un poste noyé n'apparaît pas dans le détail des frais", () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '1000' } }],
      coeffs({
        fraisAnnexes: [
          { designation: 'Caché', type: 'fixe', valeur: '100', mode: 'inclus' },
          { designation: 'Visible', type: 'fixe', valeur: '40', mode: 'separe' },
        ],
      }),
    );
    expect(res.fraisDetail!.map((f) => f.designation)).toEqual(['Visible']);
    expect(res.items[0].pv).toBe('1100'); // le poste caché est passé dans le prix
  });

  it("E.3 — les pourcentages portent tous sur le PV hors frais, quel que soit le mode", () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '1000' } }],
      coeffs({
        fraisAnnexes: [
          { designation: 'Noyé 10 %', type: 'pct', valeur: '10', mode: 'inclus' },
          { designation: 'Séparé 10 %', type: 'pct', valeur: '10', mode: 'separe' },
        ],
      }),
    );
    expect(res.fraisAnnexesIntegres).toBe('100');
    expect(res.fraisAnnexes).toBe('100');
    expect(res.pvDevis).toBe('1200');
  });

  // ── Frais de chantier repris à l'exécution (suivi de chantier) ────────────────────────────
  // Le chantier doit hériter de ce que le devis a prévu AU-DELÀ du déboursé direct : les frais
  // généraux et les frais annexes. Sans eux, le budget de chantier est incomplet dès le jour 1.

  it('frais de chantier — les FG sont repris par nature, montant par montant', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { labor: '1000', material: '500' } }],
      coeffs({
        byNature: {
          labor: rate('10', '20'), // FG = 100
          material: rate('8', '20'), // FG = 40
          equipment: rate('0', '0'),
          subcontract: rate('0', '0'),
        },
      }),
    );
    expect(res.fraisChantier!.fgByNature.labor).toBe('100');
    expect(res.fraisChantier!.fgByNature.material).toBe('40');
    // Le bénéfice n'est PAS un frais de chantier : il ne doit jamais entrer dans le budget.
    expect(res.fraisChantier!.total).toBe('140');
  });

  it('frais de chantier — chaque type de sous-traitance apporte SES frais généraux', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseBySt: { 'st-plomberie': '2000' } }],
      coeffs({
        stRates: { 'st-plomberie': rate('5', '10') }, // FG = 100
      }),
    );
    expect(res.fraisChantier!.fgBySt['st-plomberie']).toBe('100');
    expect(res.fraisChantier!.total).toBe('100');
  });

  it('frais de chantier — tous les postes de frais annexes sont repris, noyés comme séparés', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByNature: { material: '1000' } }],
      coeffs({
        fraisAnnexes: [
          { designation: 'Installation de chantier', type: 'fixe', valeur: '300', mode: 'separe' },
          { designation: 'Compte prorata', type: 'pct', valeur: '5', mode: 'inclus' },
        ],
      }),
    );
    // Le mode (noyé/séparé) ne regarde que l'ÉDITION du devis : le chantier les supporte tous.
    expect(res.fraisChantier!.postes).toEqual([
      { designation: 'Installation de chantier', montant: '300', mode: 'separe' },
      { designation: 'Compte prorata', montant: '50', mode: 'inclus' },
    ]);
    expect(res.fraisChantier!.total).toBe('350');
  });

  it('frais de chantier — options et variantes n’apportent aucun frais (hors commande)', () => {
    const res = computeFeuilleDeVente(
      [
        { id: 'A', vendable: true, debourseByNature: { labor: '1000' } },
        { id: 'OPT', vendable: true, section: 'option', debourseByNature: { labor: '5000' } },
      ],
      coeffs({
        byNature: {
          labor: rate('10', '0'),
          material: rate('0', '0'),
          equipment: rate('0', '0'),
          subcontract: rate('0', '0'),
        },
      }),
    );
    expect(res.fraisChantier!.fgByNature.labor).toBe('100'); // et non 600
  });

  // ── Types de déboursé paramétrables ───────────────────────────────────────────────────────
  // Un type porte ses propres FG/bénéfice et se rattache à une nature de base : c'est cette
  // nature qui reçoit le déboursé dans les récapitulatifs, les budgets et l'analytique.

  it('type de déboursé — applique les taux DU TYPE, pas ceux de sa nature', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByType: { 'loc-1': '1000' } }],
      coeffs({
        byNature: {
          labor: rate('0', '0'),
          material: rate('0', '0'),
          equipment: rate('50', '50'), // la nature : jamais appliquée ici
          subcontract: rate('0', '0'),
        },
        typeRates: { 'loc-1': rate('10', '20') }, // 1000 → 1100 → 1320
        typeBaseNature: { 'loc-1': 'equipment' },
      }),
    );
    expect(res.items[0].revient).toBe('1100');
    expect(res.items[0].pv).toBe('1320');
  });

  it('type de déboursé — le déboursé remonte dans la NATURE DE RATTACHEMENT du type', () => {
    const res = computeFeuilleDeVente(
      [
        {
          id: 'A',
          vendable: true,
          debourseByNature: { equipment: '500' },
          debourseByType: { 'loc-1': '1000', 'int-1': '300' },
        },
      ],
      coeffs({
        typeRates: { 'loc-1': rate('0', '0'), 'int-1': rate('0', '0') },
        typeBaseNature: { 'loc-1': 'equipment', 'int-1': 'labor' },
      }),
    );
    // Matériel = 500 en direct + 1 000 de « Location » ; MO = 300 d'« Intérim ».
    expect(res.items[0].debourseByNature.equipment).toBe('1500');
    expect(res.items[0].debourseByNature.labor).toBe('300');
  });

  it('type de déboursé — un type non paramétré retombe sur les taux de sa nature', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByType: { inconnu: '1000' } }],
      coeffs({
        byNature: {
          labor: rate('0', '0'),
          material: rate('10', '0'),
          equipment: rate('0', '0'),
          subcontract: rate('0', '0'),
        },
        typeBaseNature: { inconnu: 'material' },
      }),
    );
    expect(res.items[0].revient).toBe('1100'); // taux de la nature « matériaux »
    expect(res.items[0].debourseByNature.material).toBe('1000');
  });

  it('type de déboursé — sans nature de rattachement connue, le repli reste la sous-traitance', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseBySt: { 'st-x': '1000' } }],
      coeffs({ stRates: { 'st-x': rate('5', '0') } }),
    );
    // Compatibilité : les devis déjà chiffrés avec des types de ST gardent leur résultat.
    expect(res.items[0].revient).toBe('1050');
    expect(res.items[0].debourseByNature.subcontract).toBe('1000');
  });

  it('type de déboursé — les frais généraux repris au chantier suivent le type', () => {
    const res = computeFeuilleDeVente(
      [{ id: 'A', vendable: true, debourseByType: { 'loc-1': '2000' } }],
      coeffs({
        typeRates: { 'loc-1': rate('15', '10') }, // FG = 300
        typeBaseNature: { 'loc-1': 'equipment' },
      }),
    );
    expect(res.fraisChantier!.fgBySt['loc-1']).toBe('300');
    expect(res.fraisChantier!.total).toBe('300');
  });
});
