import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Le résultat du chantier doit dire la même chose que le devis qui l'a vendu.
 *
 * C'est LA règle de non-rupture entre l'étude de prix et le suivi de chantier : les charges
 * viennent du déboursé, les frais généraux de la feuille de vente, les produits du montant du
 * marché — donc « résultat net du budget d'étude = bénéfice du devis ». Si les deux divergent,
 * c'est que le transfert a perdu quelque chose en route, et plus personne ne fait confiance au
 * tableau de bord.
 */
describe('Suivi de chantier — charges, frais généraux, produits et résultat', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let venteHt: number;
  let codeProrata: string;
  let codeCharge: string;
  let codeFg: string;

  function as(method: 'get' | 'post' | 'put' | 'patch', path: string) {
    const s = app.getHttpServer();
    const base =
      method === 'get' ? request(s).get(path)
        : method === 'put' ? request(s).put(path)
          : method === 'patch' ? request(s).patch(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  type Metriques = Record<string, string>;
  const budgets = async () =>
    (await as('get', `/chantiers/${chantierId}/budgets`).expect(200)).body;

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Res', 'admin', [
      'estimating', 'site_tracking', 'invoicing', 'financial_management', 'core',
    ]));

    // Postes analytiques : une famille de charges, un poste de FG, deux postes de produits.
    const lotId = (await as('post', '/params/lots').send({ code: 'GO', label: 'Gros œuvre' }).expect(201)).body.id;
    const familleId = (await as('post', '/params/familles')
      .send({ lotId, code: 'MAC', label: 'Maçonnerie', nature: 'material' }).expect(201)).body.id;
    codeFg = (await as('post', '/params/codes')
      .send({ familleId, code: '900', label: 'Frais généraux', categorie: 'frais_generaux' })
      .expect(201)).body.id;
    (await as('post', '/params/codes')
      .send({ familleId, code: '800', label: 'Recettes travaux', categorie: 'produit' }).expect(201));
    codeProrata = (await as('post', '/params/codes')
      .send({ familleId, code: '860', label: 'Compte prorata', categorie: 'produit' }).expect(201)).body.id;
    codeCharge = (await as('post', '/params/codes')
      .send({ familleId, code: '250', label: 'Frais divers de chantier' }).expect(201)).body.id;

    // Devis : déboursé 10 × 100 = 1 000, FG 10 % (=100), bénéfice 20 % → vente 1 320.
    const lib = (await as('post', '/libraries').send({ code: 'LR', name: 'LR' }).expect(201)).body;
    const res = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'RR', label: 'Béton', unit: 'm3', nature: 'material', unitCost: '100' })
      .expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`)
      .send({ code: 'OR', label: 'Dalle', unit: 'm2' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`)
      .send({ kind: 'resource', childResourceId: res.id, quantity: '1' }).expect(201);

    const affaire = (await as('post', '/affaires').send({ code: 'RES-1', name: 'Résultat' }).expect(201)).body;
    await as('post', `/versions/${affaire.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Dalle', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${affaire.version.id}/frais-annexes`)
      .send({ frais: [{ designation: 'Compte prorata', type: 'fixe', valeur: '150', mode: 'inclus' }] })
      .expect(200);
    await as('put', `/versions/${affaire.version.id}/sale-sheet`)
      .send({
        byNature: {
          labor: { tauxFg: '0', tauxBenefice: '0' },
          material: { tauxFg: '10', tauxBenefice: '20' },
          equipment: { tauxFg: '0', tauxBenefice: '0' },
          subcontract: { tauxFg: '0', tauxBenefice: '0' },
        },
        tvaRate: '0.20',
      })
      .expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${affaire.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${affaire.devis.id}/accept`).expect(201)).body;
    chantierId = acc.chantier.id;
    const marches = (await as('get', `/chantiers/${chantierId}/marches`).expect(200)).body;
    venteHt = marches.reduce((t: number, m: { total_ht: string }) => t + Number(m.total_ht), 0);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('le_budget_d_etude_se_lit_en_trois_blocs_charges_frais_generaux_produits', async () => {
    const b = await budgets();
    expect(Number(b.charges.total.etude)).toBeCloseTo(1000, 2);
    // FG de la feuille de vente (10 % du déboursé = 100) + le frais annexe du devis (150) :
    // repris, jamais ressaisis.
    expect(Number(b.fraisGeneraux.total.etude)).toBeCloseTo(250, 2);
    // La recette vient du marché : aucune saisie n'est nécessaire pour l'afficher.
    expect(Number(b.produits.total.etude)).toBeCloseTo(venteHt, 2);
    expect(Number(b.produits.marches.venteMarches)).toBeCloseTo(venteHt, 2);
  });

  it('resultat_net_du_budget_d_etude_egale_le_benefice_du_devis', async () => {
    const b = await budgets();
    const charges = Number(b.charges.total.etude);
    const fg = Number(b.fraisGeneraux.total.etude);
    expect(Number(b.resultatBrut.etude)).toBeCloseTo(venteHt - charges, 2);
    expect(Number(b.resultatNet.etude)).toBeCloseTo(venteHt - charges - fg, 2);
    // Bénéfice du devis = 20 % du prix de revient (déboursé + FG) = 220 pour 1 100.
    expect(Number(b.resultatNet.etude)).toBeCloseTo(220, 2);
  });

  it('un_produit_negatif_prorata_ampute_les_deux_resultats_sans_toucher_aux_charges', async () => {
    const avant = await budgets();
    const chargesAvant = (
      await as('get', `/chantiers/${chantierId}/results`).expect(200)
    ).body.totals.budgetObjectif;

    await as('post', `/chantiers/${chantierId}/budgets/mouvements`)
      .send({ codeAnalytiqueId: codeProrata, libelle: 'Compte prorata', montant: '-50' })
      .expect(201);

    const apres = await budgets();
    expect(Number(apres.produits.total.global)).toBeCloseTo(Number(avant.produits.total.global) - 50, 2);
    expect(Number(apres.resultatNet.global)).toBeCloseTo(Number(avant.resultatNet.global) - 50, 2);
    // Une recette en moins n'est pas une dépense en plus : le budget de charges ne bouge pas.
    expect(Number(apres.charges.total.global)).toBeCloseTo(Number(avant.charges.total.global), 2);
    const chargesApres = (
      await as('get', `/chantiers/${chantierId}/results`).expect(200)
    ).body.totals.budgetObjectif;
    expect(Number(chargesApres)).toBeCloseTo(Number(chargesAvant), 2);
  });

  it('un_frais_general_saisi_pese_sur_le_resultat_net_mais_pas_sur_le_resultat_brut', async () => {
    const avant = await budgets();
    await as('post', `/chantiers/${chantierId}/budgets/mouvements`)
      .send({ codeAnalytiqueId: codeFg, libelle: 'Assurance chantier', montant: '200' })
      .expect(201);

    const apres = await budgets();
    expect(Number(apres.fraisGeneraux.total.global)).toBeCloseTo(Number(avant.fraisGeneraux.total.global) + 200, 2);
    expect(Number(apres.resultatBrut.global)).toBeCloseTo(Number(avant.resultatBrut.global), 2);
    expect(Number(apres.resultatNet.global)).toBeCloseTo(Number(avant.resultatNet.global) - 200, 2);
    // Un frais général reste un COÛT : le contrôle de gestion doit le voir.
    const results = (await as('get', `/chantiers/${chantierId}/results`).expect(200)).body;
    const so = results.byNature.find((n: { nature: string }) => n.nature === 'site_overhead');
    expect(Number(so.budgetObjectif)).toBeCloseTo(450, 2); // 100 FG + 150 frais annexe + 200 saisis
  });

  it('le_budget_initial_fige_aussi_la_recette_pour_garder_un_resultat_de_reference', async () => {
    await as('post', `/chantiers/${chantierId}/budgets/initial`).expect(201);
    const b = await budgets();
    expect(Number(b.produits.total.initial)).toBeCloseTo(Number(b.produits.total.global), 2);
    expect(Number(b.resultatNet.initial)).toBeCloseTo(Number(b.resultatNet.global), 2);
  });

  it('un_frais_du_devis_ventile_apparait_sous_son_code_et_non_dans_un_bloc_anonyme', async () => {
    // Les frais annexes du devis (compte prorata, heures d'insertion…) arrivent sur la ligne non
    // vendable « Frais de chantier ». Tant qu'ils n'ont pas de code, ils restent en frais généraux
    // « non ventilés » ; dès qu'on leur en donne un, ils doivent se voir sous ce code.
    const nomenclature = (await as('get', `/chantiers/${chantierId}/nomenclature`).expect(200)).body;
    const frais = nomenclature.find((n: { nature: string }) => n.nature === 'site_overhead');
    if (!frais) return; // ce devis n'a pas de frais annexes : rien à vérifier

    const avant = await budgets();
    expect(Number(avant.fraisGeneraux.fraisChantier.metrics.etude)).toBeGreaterThan(0);

    await as('put', `/chantiers/${chantierId}/nomenclature/${frais.id}/code-analytique`)
      .send({ codeAnalytiqueId: codeCharge })
      .expect(200);

    const apres = await budgets();
    const ligne = apres.charges.natures
      .flatMap((n: { lots: { familles: { codes: { code: string; metrics: Metriques }[] }[] }[] }) => n.lots)
      .flatMap((l: { familles: { codes: { code: string; metrics: Metriques }[] }[] }) => l.familles)
      .flatMap((f: { codes: { code: string; metrics: Metriques }[] }) => f.codes)
      .find((c: { code: string }) => c.code === '250');
    expect(Number(ligne.metrics.etude)).toBeGreaterThan(0);
    // Le total ne bouge pas : le montant a changé de bloc, pas de valeur.
    expect(Number(apres.total.global)).toBeCloseTo(Number(avant.total.global), 2);
    expect(Number(apres.resultatNet.global)).toBeCloseTo(Number(avant.resultatNet.global), 2);
  });

  it('les_postes_de_produits_ne_polluent_pas_l_axe_analytique_des_charges', async () => {
    const analytique = (
      await as('get', `/chantiers/${chantierId}/analytical-results`).expect(200)
    ).body;
    const codes = analytique.natures
      .flatMap((n: { lots: { familles: { codes: { code: string }[] }[] }[] }) => n.lots)
      .flatMap((l: { familles: { codes: { code: string }[] }[] }) => l.familles)
      .flatMap((f: { codes: { code: string }[] }) => f.codes)
      .map((c: { code: string }) => c.code);
    expect(codes).not.toContain('860');
    expect(codes).not.toContain('800');
  });
});
