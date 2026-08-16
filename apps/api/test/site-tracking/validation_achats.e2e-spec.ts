import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { createUser } from '../support/entitlements.helpers';
import { EntitlementsService } from '../../src/core/entitlements/entitlements.service';
import { RbacService } from '../../src/core/rbac/rbac.service';

/**
 * Circuit de validation des achats.
 *
 * Sans seuil, une commande de 80 000 € part aussi facilement qu'une caisse de gants. Ces tests
 * fixent les règles : le seuil déclenche l'attente, seul le désigné tranche, et RIEN n'est engagé
 * tant que la commande n'est pas validée — c'est tout l'intérêt d'un visa.
 */
describe('Site-tracking — validation des achats', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let directeurId: string;
  let conducteurId: string;
  let chantierId: string;
  let autreChantier: string;

  function as(method: 'get' | 'post' | 'delete', path: string, who = userId) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'delete' ? request(s).delete(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', who);
  }

  async function commande(chantier: string, montant: string): Promise<string> {
    const bc = (await as('post', `/chantiers/${chantier}/purchase-orders`).send({}).expect(201)).body;
    await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({ nature: 'material', designation: 'Lot', quantity: '1', unitPrice: montant })
      .expect(201);
    return bc.id;
  }

  const engage = async (chantier: string) =>
    Number((await as('get', `/chantiers/${chantier}/results`).expect(200)).body.totals.engage);

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Valid', 'admin', ['site_tracking']));

    directeurId = await createUser(ds, tenantId, 'directeur@valid.test');
    conducteurId = await createUser(ds, tenantId, 'conducteur@valid.test');
    for (const u of [directeurId, conducteurId]) {
      await app.get(EntitlementsService).assignSeat(tenantId, 'site_tracking', u);
      await app.get(RbacService).assignRole(tenantId, u, 'conducteur');
    }

    chantierId = (await as('post', '/chantiers').send({ name: 'Tour Nord' }).expect(201)).body.id;
    autreChantier = (await as('post', '/chantiers').send({ name: 'Villa Sud' }).expect(201)).body.id;

    // Règle SOCIÉTÉ : au-delà de 5 000 €, le directeur approuve.
    await as('post', '/validation-achats/regles')
      .send({ montantMin: '5000', validatorId: directeurId })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('envoie_directement_une_commande_sous_le_seuil', async () => {
    const id = await commande(autreChantier, '1200');
    const r = (await as('post', `/purchase-orders/${id}/submit`).expect(201)).body;
    expect(r.statut).toBe('validated');
    expect(await engage(autreChantier)).toBe(1200);
  });

  it('met_en_attente_au_dessus_du_seuil_et_nengage_rien', async () => {
    const avant = await engage(chantierId);
    const id = await commande(chantierId, '8000');

    const r = (await as('post', `/purchase-orders/${id}/submit`).expect(201)).body;
    expect(r.statut).toBe('pending_approval');
    expect(r.validateurs).toHaveLength(1);

    // Une commande en attente n'engage RIEN : c'est tout l'intérêt du visa.
    expect(await engage(chantierId)).toBe(avant);

    // Et elle ne se modifie plus tant qu'elle est au visa.
    await as('post', `/purchase-orders/${id}/lines`)
      .send({ nature: 'material', designation: 'Ajout', quantity: '1', unitPrice: '10' })
      .expect(409);
  });

  it('seul_le_validateur_designe_approuve_et_lengage_suit', async () => {
    const avant = await engage(chantierId);
    const id = await commande(chantierId, '9000');
    await as('post', `/purchase-orders/${id}/submit`).expect(201);

    await as('post', `/purchase-orders/${id}/approve`, conducteurId).send({}).expect(403);

    const r = (await as('post', `/purchase-orders/${id}/approve`, directeurId).send({}).expect(201)).body;
    expect(r.statut).toBe('validated');
    expect(await engage(chantierId)).toBe(avant + 9000);
  });

  it('un_refus_ramene_en_brouillon_avec_son_motif', async () => {
    const id = await commande(chantierId, '7000');
    await as('post', `/purchase-orders/${id}/submit`).expect(201);

    await as('post', `/purchase-orders/${id}/reject`, directeurId).send({}).expect(400);

    const r = (await as('post', `/purchase-orders/${id}/reject`, directeurId)
      .send({ motif: 'Consulter un deuxième fournisseur' }).expect(201)).body;
    expect(r.statut).toBe('draft');

    const journal = (await as('get', `/purchase-orders/${id}/events`).expect(200)).body;
    expect(journal[0].action).toBe('rejected');
    expect(journal[0].motif).toBe('Consulter un deuxième fournisseur');

    // Corrigée, elle se resoumet.
    await as('post', `/purchase-orders/${id}/lines`)
      .send({ nature: 'material', designation: 'Remise', quantity: '1', unitPrice: '-2500' })
      .expect(201);
    expect((await as('post', `/purchase-orders/${id}/submit`).expect(201)).body.statut).toBe('validated');
  });

  it('les_regles_du_chantier_remplacent_celles_de_la_societe', async () => {
    // Sur ce chantier, tout passe par le directeur, même 100 €.
    await as('post', '/validation-achats/regles')
      .send({ chantierId, montantMin: '0', validatorId: directeurId })
      .expect(201);

    const id = await commande(chantierId, '100');
    expect((await as('post', `/purchase-orders/${id}/submit`).expect(201)).body.statut)
      .toBe('pending_approval');

    // L'autre chantier reste sur la règle société : 1 200 € passent tout seuls.
    const autre = await commande(autreChantier, '1200');
    expect((await as('post', `/purchase-orders/${autre}/submit`).expect(201)).body.statut)
      .toBe('validated');
  });

  it('exige_TOUS_les_validateurs_requis_avant_de_partir', async () => {
    const second = await createUser(ds, tenantId, 'second@valid.test');
    await app.get(EntitlementsService).assignSeat(tenantId, 'site_tracking', second);
    await app.get(RbacService).assignRole(tenantId, second, 'conducteur');
    await as('post', '/validation-achats/regles')
      .send({ chantierId, montantMin: '50000', validatorId: second })
      .expect(201);

    const id = await commande(chantierId, '60000');
    await as('post', `/purchase-orders/${id}/submit`).expect(201);

    const premier = (await as('post', `/purchase-orders/${id}/approve`, directeurId).send({}).expect(201)).body;
    expect(premier.statut).toBe('pending_approval');
    expect(premier.manquants).toHaveLength(1);

    const dernier = (await as('post', `/purchase-orders/${id}/approve`, second).send({}).expect(201)).body;
    expect(dernier.statut).toBe('validated');
  });
});
