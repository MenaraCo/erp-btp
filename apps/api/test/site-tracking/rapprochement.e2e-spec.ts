import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Rapprochement commande / réception / facture, ligne à ligne.
 *
 * Une réception globale ne dit pas ce qui manque, et un total de facture ne dit pas ce qui est
 * facturé trop cher. Ces tests fixent les trois réponses attendues : ce qui reste à recevoir, ce
 * qui reste à facturer, et l'écart de prix entre commande et facture.
 */
describe('Site-tracking — rapprochement des achats', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;

  function as(method: 'get' | 'post' | 'patch', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'patch' ? request(s).patch(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  /** Commande envoyée de 10 sacs à 50 € et 4 h de grue à 100 €. */
  async function commandeEnvoyee(): Promise<{ id: string; sacs: string; grue: string }> {
    const bc = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({}).expect(201)).body;
    const sacs = (await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({ nature: 'material', designation: 'Sacs de colle', quantity: '10', unitPrice: '50' })
      .expect(201)).body;
    const grue = (await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({ nature: 'equipment', designation: 'Grue', quantity: '4', unitPrice: '100' })
      .expect(201)).body;
    await as('post', `/purchase-orders/${bc.id}/submit`).expect(201);
    return { id: bc.id, sacs: sacs.id, grue: grue.id };
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Rappro', 'admin', ['site_tracking', 'core']));
    chantierId = (await as('post', '/chantiers').send({ name: 'Tour Nord' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('reprend_les_lignes_de_la_commande_avec_le_reste_a_recevoir', async () => {
    const { id } = await commandeEnvoyee();
    const t = (await as('get', `/purchase-orders/${id}/rapprochement`).expect(200)).body;

    expect(t.lignes).toHaveLength(2);
    expect(t.receptionEtat).toBe('aucune');
    expect(t.soldee).toBe(false);
    const sacs = t.lignes[0];
    expect(Number(sacs.quantiteCommandee)).toBe(10);
    expect(Number(sacs.quantiteRecue)).toBe(0);
    expect(Number(sacs.resteARecevoir)).toBe(10);
  });

  it('une_livraison_partielle_laisse_la_commande_partiellement_receptionnee', async () => {
    const { id, sacs } = await commandeEnvoyee();
    const bl = (await as('post', `/purchase-orders/${id}/receptions`)
      .send({ lignes: [{ orderLineId: sacs, quantite: '6' }] })
      .expect(201)).body;
    expect(bl.code).toMatch(/^BL-/);
    expect(bl.etat).toBe('partielle');

    const t = (await as('get', `/purchase-orders/${id}/rapprochement`).expect(200)).body;
    expect(t.receptionEtat).toBe('partielle');
    const ligneSacs = t.lignes.find((l: { orderLineId: string }) => l.orderLineId === sacs);
    expect(Number(ligneSacs.quantiteRecue)).toBe(6);
    expect(Number(ligneSacs.resteARecevoir)).toBe(4);
  });

  it('la_commande_passe_en_reception_complete_quand_tout_est_arrive', async () => {
    const { id, sacs, grue } = await commandeEnvoyee();
    await as('post', `/purchase-orders/${id}/receptions`)
      .send({ lignes: [{ orderLineId: sacs, quantite: '10' }] }).expect(201);
    expect((await as('get', `/purchase-orders/${id}/rapprochement`).expect(200)).body.receptionEtat)
      .toBe('partielle');

    const dernier = (await as('post', `/purchase-orders/${id}/receptions`)
      .send({ lignes: [{ orderLineId: grue, quantite: '4' }] }).expect(201)).body;
    expect(dernier.etat).toBe('complete');
  });

  it('refuse_de_recevoir_plus_que_commande', async () => {
    const { id, sacs } = await commandeEnvoyee();
    await as('post', `/purchase-orders/${id}/receptions`)
      .send({ lignes: [{ orderLineId: sacs, quantite: '12' }] })
      .expect(400);

    await as('post', `/purchase-orders/${id}/receptions`)
      .send({ lignes: [{ orderLineId: sacs, quantite: '10' }] }).expect(201);
    // Et une seconde livraison sur une ligne déjà soldée est refusée elle aussi.
    await as('post', `/purchase-orders/${id}/receptions`)
      .send({ lignes: [{ orderLineId: sacs, quantite: '1' }] })
      .expect(400);
  });

  it('compare_le_prix_facture_au_prix_commande_et_chiffre_lecart', async () => {
    const { id, sacs } = await commandeEnvoyee();
    await as('post', `/purchase-orders/${id}/receptions`)
      .send({ lignes: [{ orderLineId: sacs, quantite: '10' }] }).expect(201);

    // Le fournisseur facture 10 sacs à 55 € au lieu de 50 : 50 € de trop.
    const facture = (await as('post', `/purchase-orders/${id}/factures`)
      .send({ code: 'FF-2026-1', lignes: [{ orderLineId: sacs, quantite: '10', puFacture: '55' }] })
      .expect(201)).body;
    expect(Number(facture.montantHt)).toBe(550);

    const t = (await as('get', `/purchase-orders/${id}/rapprochement`).expect(200)).body;
    const ligne = t.lignes.find((l: { orderLineId: string }) => l.orderLineId === sacs);
    expect(Number(ligne.puCommande)).toBe(50);
    expect(Number(ligne.puFacture)).toBe(55);
    expect(Number(ligne.ecartPrix)).toBe(50);
    expect(Number(t.ecartPrixTotal)).toBe(50);
    expect(t.factureEtat).toBe('partielle'); // la grue reste à facturer
  });

  it('solde_la_commande_quand_tout_est_recu_ET_facture', async () => {
    const { id, sacs, grue } = await commandeEnvoyee();
    await as('post', `/purchase-orders/${id}/receptions`)
      .send({ lignes: [{ orderLineId: sacs, quantite: '10' }, { orderLineId: grue, quantite: '4' }] })
      .expect(201);
    await as('post', `/purchase-orders/${id}/factures`)
      .send({
        code: 'FF-2026-2',
        lignes: [{ orderLineId: sacs, quantite: '10' }, { orderLineId: grue, quantite: '4' }],
      })
      .expect(201);

    const t = (await as('get', `/purchase-orders/${id}/rapprochement`).expect(200)).body;
    expect(t.receptionEtat).toBe('complete');
    expect(t.factureEtat).toBe('complete');
    expect(t.soldee).toBe(true);
    // Sans PU facturé, on reprend celui de la commande : aucun écart inventé.
    expect(Number(t.ecartPrixTotal)).toBe(0);
  });

  it('corrige_et_supprime_une_ligne_tant_que_la_commande_est_en_brouillon', async () => {
    const bc = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({}).expect(201)).body;
    const ligne = (await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({ nature: 'material', designation: 'À corriger', quantity: '1', unitPrice: '10' })
      .expect(201)).body;

    const maj = (await as('patch', `/purchase-order-lines/${ligne.id}`)
      .send({ designation: 'Corrigée', quantity: '3', unitPrice: '20' }).expect(200)).body;
    expect(maj.designation).toBe('Corrigée');
    expect(Number(maj.amount_ht)).toBe(60);

    // L'en-tête aussi : fournisseur, adresse et date de livraison.
    const entete = (await as('patch', `/purchase-orders/${bc.id}`)
      .send({ deliveryAddress: '12 rue des Lilas', deliveryDate: '2026-09-15', deliveryConditions: 'Franco de port' })
      .expect(200)).body;
    expect(entete.delivery_address).toBe('12 rue des Lilas');
    expect(entete.delivery_conditions).toBe('Franco de port');

    await as('post', `/purchase-orders/${bc.id}/submit`).expect(201);
    // Une fois envoyée, plus rien ne bouge.
    await as('patch', `/purchase-order-lines/${ligne.id}`).send({ quantity: '9' }).expect(409);
    await as('patch', `/purchase-orders/${bc.id}`).send({ notes: 'trop tard' }).expect(409);
  });
});
