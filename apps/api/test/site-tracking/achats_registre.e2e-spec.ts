import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Registre des achats : retrouver une commande parmi cinquante, tous chantiers confondus.
 *
 * L'écran par chantier dépliait chaque commande avec ses lignes — lisible à trois commandes,
 * inutilisable à cinquante. Ce registre ne renvoie qu'une ligne par pièce, filtrable et paginée.
 */
describe('Site-tracking — registre des achats', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierA: string;
  let chantierB: string;
  let supplierId: string;

  function as(method: 'get' | 'post', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Reg', 'admin', ['site_tracking', 'core']));

    chantierA = (await as('post', '/chantiers').send({ name: 'Tour Nord' }).expect(201)).body.id;
    chantierB = (await as('post', '/chantiers').send({ name: 'Villa Sud' }).expect(201)).body.id;
    supplierId = (await as('post', '/suppliers').send({ name: 'Point P' }).expect(201)).body.id;

    // Trois commandes : deux sur A (dont une chez Point P), une sur B.
    const bc1 = (await as('post', `/chantiers/${chantierA}/purchase-orders`).send({ supplierId }).expect(201)).body;
    await as('post', `/purchase-orders/${bc1.id}/lines`)
      .send({ nature: 'material', designation: 'Ciment', quantity: '10', unitPrice: '100' }).expect(201);
    await as('post', `/chantiers/${chantierA}/purchase-orders`).send({}).expect(201);
    await as('post', `/chantiers/${chantierB}/purchase-orders`).send({ supplierId }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('liste_toutes_les_commandes_avec_leur_chantier_et_leur_fournisseur', async () => {
    const r = (await as('get', '/achats/commandes').expect(200)).body;
    expect(r.total).toBe(3);
    expect(r.lignes).toHaveLength(3);

    const avecLignes = r.lignes.find((l: { nbLignes: number }) => l.nbLignes > 0);
    expect(avecLignes.fournisseur).toBe('Point P');
    expect(avecLignes.chantierNom).toBe('Tour Nord');
    expect(Number(avecLignes.totalHt)).toBe(1000);
    expect(avecLignes.code).toMatch(/^BC-/);
  });

  it('filtre_par_chantier_par_fournisseur_et_par_recherche_libre', async () => {
    const parChantier = (await as('get', `/achats/commandes?chantier=${chantierB}`).expect(200)).body;
    expect(parChantier.total).toBe(1);

    const parFournisseur = (await as('get', `/achats/commandes?fournisseur=${supplierId}`).expect(200)).body;
    expect(parFournisseur.total).toBe(2);

    // La recherche libre porte aussi sur le nom du chantier.
    const recherche = (await as('get', '/achats/commandes?q=Villa').expect(200)).body;
    expect(recherche.total).toBe(1);
    expect(recherche.lignes[0].chantierNom).toBe('Villa Sud');

    const inconnu = (await as('get', '/achats/commandes?q=ZZZZ').expect(200)).body;
    expect(inconnu.total).toBe(0);
  });

  it('pagine_sans_perdre_le_total_ni_le_montant_cumule', async () => {
    const page1 = (await as('get', '/achats/commandes?parPage=2&page=1').expect(200)).body;
    expect(page1.lignes).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(Number(page1.montantTotal)).toBe(1000); // le montant porte sur TOUT le filtre, pas la page

    const page2 = (await as('get', '/achats/commandes?parPage=2&page=2').expect(200)).body;
    expect(page2.lignes).toHaveLength(1);
    const ids = [...page1.lignes, ...page2.lignes].map((l: { id: string }) => l.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('liste_les_receptions_et_les_factures_rattachees_a_leur_commande', async () => {
    const r = (await as('get', '/achats/commandes?q=Tour').expect(200)).body;
    const id = r.lignes.find((l: { nbLignes: number }) => l.nbLignes > 0).id;
    await as('post', `/purchase-orders/${id}/validate`).expect(201);
    await as('post', `/purchase-orders/${id}/delivery-notes`).send({}).expect(201);
    await as('post', `/purchase-orders/${id}/invoices`)
      .send({ code: 'FF-1', nature: 'material', amountHt: '950', invoiceDate: '2026-09-10' })
      .expect(201);

    const receptions = (await as('get', '/achats/receptions').expect(200)).body;
    expect(receptions.total).toBe(1);
    expect(receptions.lignes[0].fournisseur).toBe('Point P');
    expect(receptions.lignes[0].code).toMatch(/^BL-/);

    const factures = (await as('get', '/achats/factures').expect(200)).body;
    expect(factures.total).toBe(1);
    expect(Number(factures.montantTotal)).toBe(950);
    expect(factures.lignes[0].commande).toMatch(/^BC-/);

    // Et la recherche libre traverse la commande comme le fournisseur.
    expect((await as('get', '/achats/factures?q=Point').expect(200)).body.total).toBe(1);
    expect((await as('get', '/achats/receptions?q=ZZZ').expect(200)).body.total).toBe(0);
  });

  it('ouvre_la_fiche_dune_commande_avec_ses_lignes', async () => {
    const r = (await as('get', '/achats/commandes?q=Tour').expect(200)).body;
    const id = r.lignes.find((l: { nbLignes: number }) => l.nbLignes > 0).id;

    const fiche = (await as('get', `/purchase-orders/${id}`).expect(200)).body;
    expect(fiche.commande.chantier_code).toBeTruthy();
    expect(fiche.lignes).toHaveLength(1);
    expect(fiche.lignes[0].designation).toBe('Ciment');
    // Ce test s'exécute après l'ajout d'un BL et d'une facture : la fiche les rappelle.
    expect(fiche.receptions).toHaveLength(1);
    expect(fiche.factures).toHaveLength(1);
    expect(Number(fiche.factures[0].amount_ht)).toBe(950);
  });
});
