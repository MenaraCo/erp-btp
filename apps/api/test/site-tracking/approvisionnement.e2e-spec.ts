import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Approvisionnement : de la nomenclature du chantier au bon de commande.
 *
 * Ressaisir les lignes à la main, c'est retaper ce que l'étude a chiffré, confondre l'unité
 * d'emploi et l'unité d'achat (le kilo et le sac), et surtout ne jamais savoir ce qui reste à
 * commander. Ces tests fixent les trois règles : conversion en unité d'achat, décompte du reste,
 * et quantité débloquée par l'avancement.
 */
describe('Site-tracking — approvisionnement depuis la nomenclature', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let supplierId: string;
  let ouvrageId: string;
  let libId: string;

  function as(method: 'get' | 'post' | 'put' | 'patch', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'put' ? request(s).put(path)
        : method === 'patch' ? request(s).patch(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Appro', 'admin', ['estimating', 'site_tracking', 'core', 'financial_management']));

    supplierId = (await as('post', '/suppliers').send({ name: 'Point P' }).expect(201)).body.id;

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    libId = lib.id;
    // Colle vendue au SAC de 25 kg : l'étude chiffre au kg, l'achat se fait au sac.
    const colle = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({
          code: 'COLLE', label: 'Colle carrelage', unit: 'kg', nature: 'material', unitCost: '2',
          uniteAchat: 'sac', coeffConversion: '25', supplierId, refFournisseur: 'PP-4412',
        })
        .expect(201)
    ).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`)
      .send({ code: 'O', label: 'Carrelage', unit: 'm2' }).expect(201)).body;
    ouvrageId = ouv.id;
    // 2 kg de colle par m².
    await as('post', `/ouvrages/${ouv.id}/components`)
      .send({ kind: 'resource', childResourceId: colle.id, quantity: '2' }).expect(201);

    const affaire = (await as('post', '/affaires').send({ code: 'AP-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${affaire.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Carrelage', sourceOuvrageId: ouv.id, quantity: '100' })
      .expect(201);
    await as('put', `/versions/${affaire.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${affaire.devis.id}/transition`).send({ to }).expect(201);
    }
    chantierId = (await as('post', `/devis/${affaire.devis.id}/accept`).expect(201)).body.chantier.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('reprend_le_besoin_du_budget_avec_le_fournisseur_et_lunite_dachat', async () => {
    const appro = (await as('get', `/chantiers/${chantierId}/approvisionnement`).expect(200)).body;
    const colle = appro.lignes.find((l: { code: string }) => l.code === 'COLLE');

    expect(Number(colle.quantiteBudget)).toBe(200);   // 100 m² × 2 kg
    expect(colle.uniteAchat).toBe('sac');
    expect(Number(colle.coeffConversion)).toBe(25);
    expect(Number(colle.puAchat)).toBe(50);           // 2 €/kg × 25 kg
    expect(colle.fournisseur).toBe('Point P');
    expect(colle.ouvrage).toBe('Carrelage');
    expect(Number(colle.quantiteCommandee)).toBe(0);
  });

  it('insere_le_besoin_total_converti_en_unite_dachat_et_decompte_le_reste', async () => {
    const bc = (await as('post', `/chantiers/${chantierId}/purchase-orders`)
      .send({ supplierId }).expect(201)).body;
    // Le numéro n'est plus saisi : il vient de la numérotation société.
    expect(bc.code).toMatch(/^BC-\d{4}-\d{4}$/);

    const insertion = (await as('post', `/purchase-orders/${bc.id}/lines/nomenclature`)
      .send({ mode: 'total', filtre: { supplierId } }).expect(201)).body;
    expect(insertion.inserees).toBe(1);

    const lignes = (await as('get', `/purchase-orders/${bc.id}/lines`).expect(200)).body;
    // Le code de la ressource remplit la colonne « Code » : il sert ensuite à retrouver l'article.
    expect(lignes[0].code).toBe('COLLE');
    expect(lignes[0].designation).toBe('Colle carrelage');
    expect(lignes[0].unite_achat).toBe('sac');
    expect(Number(lignes[0].quantity)).toBe(8);       // 200 kg ÷ 25 kg par sac
    expect(Number(lignes[0].unit_price)).toBe(50);
    expect(Number(lignes[0].amount_ht)).toBe(400);    // = 200 kg × 2 €/kg, le budget matière
    expect(lignes[0].nomenclature_resource_id).toBeTruthy();
    expect(lignes[0].code_analytique_id ?? null).toEqual(lignes[0].code_analytique_id ?? null);

    // Le besoin est couvert : il ne reste rien à commander.
    const appro = (await as('get', `/chantiers/${chantierId}/approvisionnement`).expect(200)).body;
    const colle = appro.lignes.find((l: { code: string }) => l.code === 'COLLE');
    expect(Number(colle.quantiteCommandee)).toBe(200);
    expect(Number(colle.quantiteRestante)).toBe(0);

    // Et une seconde commande « au reste » n'insère plus rien plutôt qu'une ligne à zéro.
    const bc2 = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({}).expect(201)).body;
    const vide = (await as('post', `/purchase-orders/${bc2.id}/lines/nomenclature`)
      .send({ mode: 'reste' }).expect(201)).body;
    expect(vide.inserees).toBe(0);
  });

  it('un_code_de_la_nomenclature_remplit_la_ligne_avec_le_prix_du_chantier', async () => {
    const bc = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({}).expect(201)).body;
    const ligne = (await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({ nature: 'material', designation: 'À remplacer', quantity: '3', unitPrice: '0' })
      .expect(201)).body;

    // COLLE est chiffrée POUR CE CHANTIER : c'est son prix qui doit être repris, pas celui du
    // catalogue — un prix négocié sur un chantier ne remonte pas dans la bibliothèque.
    const maj = (await as('patch', `/purchase-order-lines/${ligne.id}`)
      .send({ code: 'colle' }).expect(200)).body;
    expect(maj.designation).toBe('Colle carrelage');
    expect(maj.unite_achat).toBe('sac');
    expect(Number(maj.coeff_conversion)).toBe(25);
    expect(Number(maj.unit_price)).toBe(50);     // 2 €/kg × 25 kg par sac
    expect(Number(maj.amount_ht)).toBe(150);     // 3 sacs

    // Une ressource SANS unité d'achat ni conditionnement ne doit pas faire échouer la reprise :
    // c'est le cas le plus courant d'un chantier (unité d'emploi seule).
    const brut = (await as('post', `/libraries/${libId}/resources`)
      .send({ code: 'BETON', label: 'Béton C25/30', unit: 'M3', nature: 'material', unitCost: '120' })
      .expect(201)).body;
    expect(brut.code).toBe('BETON');
    const sansConditionnement = (await as('patch', `/purchase-order-lines/${ligne.id}`)
      .send({ code: 'BETON' }).expect(200)).body;
    expect(sansConditionnement.designation).toBe('Béton C25/30');
    expect(Number(sansConditionnement.unit_price)).toBe(120);

    // L'intitulé reste modifiable : la reprise propose, elle n'impose pas.
    const corrige = (await as('patch', `/purchase-order-lines/${ligne.id}`)
      .send({ designation: 'Béton — teinte grise' }).expect(200)).body;
    expect(corrige.designation).toBe('Béton — teinte grise');
    expect(corrige.code).toBe('BETON');
  });

  it('limite_la_quantite_a_lavancement_quand_on_le_demande', async () => {
    // Nouveau chantier : celui d'au-dessus est déjà entièrement commandé.
    const affaire = (await as('post', '/affaires').send({ code: 'AP-2', name: 'B' }).expect(201)).body;
    await as('post', `/versions/${affaire.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Carrelage', sourceOuvrageId: ouvrageId, quantity: '100' })
      .expect(201);
    await as('put', `/versions/${affaire.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${affaire.devis.id}/transition`).send({ to }).expect(201);
    }
    const ch2 = (await as('post', `/devis/${affaire.devis.id}/accept`).expect(201)).body.chantier.id;

    const arbre = (await as('get', `/chantiers/${ch2}/execution-tree`).expect(200)).body;
    const ligne = arbre.marches[0].lines[0];
    await as('post', `/chantiers/${ch2}/line-advancement`)
      .send({ executionLineId: ligne.id, pct: '0.4' }).expect(201);

    const appro = (await as('get', `/chantiers/${ch2}/approvisionnement`).expect(200)).body;
    const colle = appro.lignes.find((l: { code: string }) => l.code === 'COLLE');
    expect(Number(colle.quantiteBudget)).toBe(200);
    expect(Number(colle.quantiteAvancement)).toBe(80); // 40 % de 200 kg

    const bc = (await as('post', `/chantiers/${ch2}/purchase-orders`).send({}).expect(201)).body;
    await as('post', `/purchase-orders/${bc.id}/lines/nomenclature`)
      .send({ mode: 'avancement' }).expect(201);

    const lignes = (await as('get', `/purchase-orders/${bc.id}/lines`).expect(200)).body;
    expect(Number(lignes[0].quantity)).toBe(3.2);      // 80 kg ÷ 25
  });
});
