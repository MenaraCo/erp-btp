import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Stocks : ce que l'entreprise possède déjà, et ce qu'il en coûte au chantier.
 *
 * Deux règles font tout le module. Le PRIX MOYEN PONDÉRÉ se recalcule à l'entrée et jamais à la
 * sortie — sinon un même sac de ciment sortirait à trois prix selon le lot dont il vient. Et une
 * SORTIE vers un chantier est une dépense réelle : sans cela le magasin absorbe des coûts que
 * personne ne voit passer, et le chantier paraît moins cher qu'il n'est.
 */
describe('Stocks — prix moyen pondéré, dépôts et imputation chantier', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let magasin: string;
  let depotChantier: string;
  let article: string;
  let codeAnalytique: string;

  function as(method: 'get' | 'post' | 'patch', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'patch' ? request(s).patch(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Stock', 'admin', [
      'core', 'site_tracking', 'stock_equipment', 'financial_management',
    ]));

    chantierId = (await as('post', '/chantiers').send({ name: 'Tour Sud' }).expect(201)).body.id;
    const lotId = (await as('post', '/params/lots').send({ code: 'GO', label: 'Gros œuvre' }).expect(201)).body.id;
    const familleId = (await as('post', '/params/familles')
      .send({ lotId, code: 'MAC', label: 'Maçonnerie', nature: 'material' }).expect(201)).body.id;
    codeAnalytique = (await as('post', '/params/codes')
      .send({ familleId, code: '250', label: 'Ciment' }).expect(201)).body.id;

    magasin = (await as('post', '/stock/depots')
      .send({ code: 'MAG', label: 'Magasin central' }).expect(201)).body.id;
    depotChantier = (await as('post', '/stock/depots')
      .send({ code: 'DEP-TS', label: 'Dépôt Tour Sud', type: 'chantier', chantierId }).expect(201)).body.id;
    article = (await as('post', '/stock/articles')
      .send({ code: 'CIM32', label: 'Ciment 32,5 — sac 35 kg', unit: 'sac', codeAnalytiqueId: codeAnalytique })
      .expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('le_prix_moyen_pondere_se_recalcule_a_chaque_entree', async () => {
    // 100 sacs à 5 €, puis 100 à 7 € → moyenne 6 €.
    const e1 = (await as('post', '/stock/entrees')
      .send({ articleId: article, depotId: magasin, quantite: '100', pu: '5' }).expect(201)).body;
    expect(Number(e1.pmp)).toBeCloseTo(5, 4);

    const e2 = (await as('post', '/stock/entrees')
      .send({ articleId: article, depotId: magasin, quantite: '100', pu: '7' }).expect(201)).body;
    expect(Number(e2.pmp)).toBeCloseTo(6, 4);
    expect(Number(e2.quantite)).toBeCloseTo(200, 3);
  });

  it('une_sortie_part_au_prix_moyen_et_ne_le_change_pas', async () => {
    const s = (await as('post', '/stock/sorties')
      .send({ articleId: article, depotId: magasin, quantite: '50', chantierId }).expect(201)).body;
    expect(Number(s.montant)).toBeCloseTo(300, 2); // 50 × 6 €

    const etat = (await as('get', `/stock/etat?depot=${magasin}`).expect(200)).body;
    const ligne = etat.find((l: { article_id: string }) => l.article_id === article);
    expect(Number(ligne.quantite)).toBeCloseTo(150, 3);
    expect(Number(ligne.pmp)).toBeCloseTo(6, 4);   // sortir ne change pas la valeur de ce qui reste
    expect(Number(ligne.valeur)).toBeCloseTo(900, 2);
  });

  it('une_sortie_vers_un_chantier_devient_une_depense_reelle_imputee', async () => {
    const res = (await as('get', `/chantiers/${chantierId}/results`).expect(200)).body;
    const materiaux = res.byNature.find((n: { nature: string }) => n.nature === 'material');
    expect(Number(materiaux.realise)).toBeCloseTo(300, 2);

    // Et au bon poste analytique : celui de l'article, sans qu'on ait eu à le redire.
    const analytique = (await as('get', `/chantiers/${chantierId}/analytical-results`).expect(200)).body;
    const codes = analytique.natures
      .flatMap((n: { lots: { familles: { codes: { code: string; metrics: Record<string, string> }[] }[] }[] }) => n.lots)
      .flatMap((l: { familles: { codes: { code: string; metrics: Record<string, string> }[] }[] }) => l.familles)
      .flatMap((f: { codes: { code: string; metrics: Record<string, string> }[] }) => f.codes);
    const ciment = codes.find((c: { code: string }) => c.code === '250');
    expect(Number(ciment.metrics.realise)).toBeCloseTo(300, 2);
  });

  it('refuse_de_sortir_plus_que_ce_que_le_depot_contient', async () => {
    const r = await as('post', '/stock/sorties')
      .send({ articleId: article, depotId: magasin, quantite: '10000', chantierId })
      .expect(400);
    expect(String(r.body.message)).toContain('insuffisant');
  });

  it('un_transfert_deplace_sans_rien_creer_ni_detruire', async () => {
    await as('post', '/stock/transferts')
      .send({ articleId: article, depotId: magasin, depotCibleId: depotChantier, quantite: '40' })
      .expect(201);

    const etat = (await as('get', '/stock/etat').expect(200)).body;
    const auMagasin = etat.find((l: { depot_id: string }) => l.depot_id === magasin);
    const auChantier = etat.find((l: { depot_id: string }) => l.depot_id === depotChantier);
    expect(Number(auMagasin.quantite)).toBeCloseTo(110, 3);
    expect(Number(auChantier.quantite)).toBeCloseTo(40, 3);
    // La somme n'a pas bougé : 150 sacs, ailleurs.
    expect(Number(auMagasin.quantite) + Number(auChantier.quantite)).toBeCloseTo(150, 3);
    // Et un transfert n'est pas une dépense : le chantier ne paie qu'à la sortie.
    const res = (await as('get', `/chantiers/${chantierId}/results`).expect(200)).body;
    const materiaux = res.byNature.find((n: { nature: string }) => n.nature === 'material');
    expect(Number(materiaux.realise)).toBeCloseTo(300, 2);
  });

  it('refuse_un_transfert_vers_le_meme_depot_et_une_quantite_nulle', async () => {
    await as('post', '/stock/transferts')
      .send({ articleId: article, depotId: magasin, depotCibleId: magasin, quantite: '1' })
      .expect(400);
    await as('post', '/stock/entrees')
      .send({ articleId: article, depotId: magasin, quantite: '0', pu: '5' })
      .expect(400);
  });

  it('le_journal_raconte_chaque_mouvement_avec_son_auteur', async () => {
    const journal = (await as('get', `/stock/mouvements?article=${article}`).expect(200)).body;
    expect(journal.length).toBeGreaterThanOrEqual(4);
    const sortie = journal.find((m: { type: string }) => m.type === 'sortie');
    expect(sortie.chantier_code).toBeTruthy();
    expect(sortie.auteur).toBeTruthy();
    expect(Number(sortie.pu)).toBeCloseTo(6, 4);
  });
});
