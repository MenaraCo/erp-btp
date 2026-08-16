import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Reporting Direction des achats : combien dépense-t-on, chez qui, sur quoi — tous chantiers.
 *
 * Le registre retrouve une pièce ; ce reporting-ci mesure une consommation. Il regroupe donc les
 * LIGNES le long d'un axe (fournisseur, ressource, code analytique, chantier…) et n'y fait entrer
 * que ce qui est réellement engagé — une commande en brouillon n'a encore rien coûté.
 */
describe('Site-tracking — reporting des achats (Direction)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierA: string;
  let chantierB: string;
  let pointP: string;
  let lafarge: string;
  let codeColle: string;
  let codeBeton: string;

  function as(method: 'get' | 'post' | 'patch', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'patch' ? request(s).patch(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  interface Ligne {
    cle: string; code: string; label: string | null;
    commande: string; receptionne: string; facture: string; ecartPrix: string;
    resteARecevoir: string; part: string; nbCommandes: number; nbChantiers: number;
    quantiteCommandee: string | null; unite: string | null; unitesMultiples: boolean;
  }
  const parCode = (r: { lignes: Ligne[] }, code: string) =>
    r.lignes.find((l) => l.code === code) as Ligne;

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Repo', 'admin', ['site_tracking', 'core', 'estimating']));

    chantierA = (await as('post', '/chantiers').send({ name: 'Tour Nord' }).expect(201)).body.id;
    chantierB = (await as('post', '/chantiers').send({ name: 'Villa Sud' }).expect(201)).body.id;
    pointP = (await as('post', '/suppliers').send({ name: 'Point P' }).expect(201)).body.id;
    lafarge = (await as('post', '/suppliers').send({ name: 'Lafarge' }).expect(201)).body.id;

    const lotId = (await as('post', '/params/lots').send({ code: 'GO', label: 'Gros œuvre' }).expect(201)).body.id;
    const familleId = (await as('post', '/params/familles')
      .send({ lotId, code: 'MAC', label: 'Maçonnerie' }).expect(201)).body.id;
    codeColle = (await as('post', '/params/codes')
      .send({ familleId, code: '280', label: 'Colle' }).expect(201)).body.id;
    codeBeton = (await as('post', '/params/codes')
      .send({ familleId, code: '310', label: 'Béton' }).expect(201)).body.id;

    // A / Point P : 10 sacs de colle à 50 € = 500 €, validée.
    const bc1 = (await as('post', `/chantiers/${chantierA}/purchase-orders`)
      .send({ supplierId: pointP }).expect(201)).body;
    const sacs = (await as('post', `/purchase-orders/${bc1.id}/lines`).send({
      nature: 'material', code: 'COLLE', designation: 'Sacs de colle', quantity: '10',
      unitPrice: '50', codeAnalytiqueId: codeColle, uniteAchat: 'SAC',
    }).expect(201)).body.id;
    await as('post', `/purchase-orders/${bc1.id}/submit`).expect(201);
    // 6 sacs reçus, 6 facturés à 55 € : l'écart de prix vaut 6 × 5 = 30 €.
    await as('post', `/purchase-orders/${bc1.id}/receptions`)
      .send({ lignes: [{ orderLineId: sacs, quantite: '6' }] }).expect(201);
    await as('post', `/purchase-orders/${bc1.id}/factures`)
      .send({ code: 'FF-1', lignes: [{ orderLineId: sacs, quantite: '6', puFacture: '55' }] })
      .expect(201);

    // B / Point P : encore 4 sacs de colle à 50 € = 200 €, validée, rien reçu.
    const bc2 = (await as('post', `/chantiers/${chantierB}/purchase-orders`)
      .send({ supplierId: pointP }).expect(201)).body;
    await as('post', `/purchase-orders/${bc2.id}/lines`).send({
      nature: 'material', code: 'COLLE', designation: 'Sacs de colle', quantity: '4',
      unitPrice: '50', codeAnalytiqueId: codeColle, uniteAchat: 'SAC',
    }).expect(201);
    await as('post', `/purchase-orders/${bc2.id}/submit`).expect(201);

    // B / Lafarge : 3 m³ de béton à 100 € = 300 €, validée.
    const bc3 = (await as('post', `/chantiers/${chantierB}/purchase-orders`)
      .send({ supplierId: lafarge }).expect(201)).body;
    await as('post', `/purchase-orders/${bc3.id}/lines`).send({
      nature: 'material', code: 'BETON', designation: 'Béton prêt à l’emploi', quantity: '3',
      unitPrice: '100', codeAnalytiqueId: codeBeton, uniteAchat: 'M3',
    }).expect(201);
    await as('post', `/purchase-orders/${bc3.id}/submit`).expect(201);

    // A / Lafarge : 1 000 € restés EN BROUILLON — engagent zéro, doivent rester hors reporting.
    const brouillon = (await as('post', `/chantiers/${chantierA}/purchase-orders`)
      .send({ supplierId: lafarge }).expect(201)).body;
    await as('post', `/purchase-orders/${brouillon.id}/lines`).send({
      nature: 'material', designation: 'Coffrage', quantity: '10', unitPrice: '100',
      codeAnalytiqueId: codeBeton,
    }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('regroupe_la_consommation_par_fournisseur_sans_compter_les_brouillons', async () => {
    const r = (await as('get', '/achats/reporting?axe=fournisseur').expect(200)).body;

    expect(Number(r.total.commande)).toBe(1000); // 500 + 200 + 300, le brouillon exclu
    const pp = parCode(r, 'Point P');
    expect(Number(pp.commande)).toBe(700);
    expect(pp.nbCommandes).toBe(2);
    expect(pp.nbChantiers).toBe(2);
    // Le plus gros fournisseur ouvre la liste : c'est la question que se pose la Direction.
    expect(r.lignes[0].code).toBe('Point P');
    expect(Number(parCode(r, 'Lafarge').commande)).toBe(300);
  });

  it('mesure_le_recu_le_facture_et_l_ecart_de_prix_a_quantite_egale', async () => {
    const r = (await as('get', '/achats/reporting?axe=fournisseur').expect(200)).body;
    const pp = parCode(r, 'Point P');

    expect(Number(pp.receptionne)).toBe(300);      // 6 sacs valorisés au prix commandé
    expect(Number(pp.resteARecevoir)).toBe(400);   // 700 commandés − 300 reçus
    expect(Number(pp.facture)).toBe(330);          // 6 × 55
    expect(Number(pp.ecartPrix)).toBe(30);         // 6 × (55 − 50) : le manque à livrer n'est pas un écart de prix
    expect(Number(r.total.ecartPrix)).toBe(30);
  });

  it('regroupe_par_ressource_avec_les_quantites_et_par_code_analytique', async () => {
    const parRessource = (await as('get', '/achats/reporting?axe=ressource').expect(200)).body;
    const colle = parCode(parRessource, 'COLLE');
    expect(Number(colle.commande)).toBe(700);
    expect(Number(colle.quantiteCommandee)).toBe(14); // les 10 du chantier A + les 4 du chantier B
    expect(colle.unite).toBe('SAC');
    expect(colle.unitesMultiples).toBe(false);
    expect(colle.label).toBe('Sacs de colle');
    expect(Number(colle.part)).toBeCloseTo(0.7, 3);

    const parCodeAnalytique = (await as('get', '/achats/reporting?axe=code').expect(200)).body;
    expect(Number(parCode(parCodeAnalytique, '280').commande)).toBe(700);
    expect(parCode(parCodeAnalytique, '280').label).toBe('Colle');
    expect(Number(parCode(parCodeAnalytique, '310').commande)).toBe(300);

    // Les axes supérieurs du plan analytique reconstituent le même total.
    const parFamille = (await as('get', '/achats/reporting?axe=famille').expect(200)).body;
    expect(Number(parCode(parFamille, 'MAC').commande)).toBe(1000);
    const parLot = (await as('get', '/achats/reporting?axe=lot').expect(200)).body;
    expect(Number(parCode(parLot, 'GO').commande)).toBe(1000);
  });

  it('regroupe_par_chantier_et_par_nature_et_filtre_sur_un_fournisseur', async () => {
    const parChantier = (await as('get', '/achats/reporting?axe=chantier').expect(200)).body;
    expect(Number(parChantier.lignes.find((l: Ligne) => l.label === 'Villa Sud').commande)).toBe(500);
    expect(Number(parChantier.lignes.find((l: Ligne) => l.label === 'Tour Nord').commande)).toBe(500);

    const parNature = (await as('get', '/achats/reporting?axe=nature').expect(200)).body;
    expect(parNature.lignes[0].code).toBe('Matériaux'); // libellé métier, pas la clé technique

    const filtre = (await as('get', `/achats/reporting?axe=ressource&fournisseur=${lafarge}`).expect(200)).body;
    expect(filtre.lignes).toHaveLength(1);
    expect(filtre.lignes[0].code).toBe('BETON');
    expect(Number(filtre.total.commande)).toBe(300);

    const parChantierFiltre = (await as('get', `/achats/reporting?axe=fournisseur&chantier=${chantierB}`).expect(200)).body;
    expect(Number(parChantierFiltre.total.commande)).toBe(500);
  });

  it('une_periode_hors_des_commandes_ne_renvoie_rien_plutot_qu_un_total_faux', async () => {
    const r = (await as('get', '/achats/reporting?axe=fournisseur&du=2000-01-01&au=2000-12-31').expect(200)).body;
    expect(r.lignes).toHaveLength(0);
    expect(Number(r.total.commande)).toBe(0);
    expect(r.total.nbGroupes).toBe(0);
  });

  it('signale_a_part_les_factures_saisies_sans_detail_de_lignes', async () => {
    const bc = (await as('post', `/chantiers/${chantierA}/purchase-orders`)
      .send({ supplierId: lafarge }).expect(201)).body;
    await as('post', `/purchase-orders/${bc.id}/lines`).send({
      nature: 'material', designation: 'Parpaings', quantity: '100', unitPrice: '2',
      codeAnalytiqueId: codeBeton,
    }).expect(201);
    await as('post', `/purchase-orders/${bc.id}/submit`).expect(201);
    // Facture d'en-tête (ancienne saisie globale) : aucun axe ne peut la ventiler.
    await as('post', `/purchase-orders/${bc.id}/invoices`)
      .send({ code: 'FF-GLOBAL', nature: 'material', amountHt: '200' }).expect(201);

    const r = (await as('get', '/achats/reporting?axe=fournisseur').expect(200)).body;
    expect(Number(r.factureHorsLignes.montant)).toBe(200);
    expect(r.factureHorsLignes.nombre).toBe(1);
    // Elle ne gonfle aucun regroupement : le facturé par axe reste celui des lignes.
    expect(Number(r.total.facture)).toBe(330);
  });
});
