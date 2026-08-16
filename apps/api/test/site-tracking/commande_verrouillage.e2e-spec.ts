import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { createUser } from '../support/entitlements.helpers';
import { EntitlementsService } from '../../src/core/entitlements/entitlements.service';
import { RbacService } from '../../src/core/rbac/rbac.service';

/**
 * Verrouillage d'une commande envoyée.
 *
 * Une commande envoyée au fournisseur est un engagement : la modifier après coup ferait mentir
 * l'engagé du chantier et laisserait le fournisseur avec une autre version que la nôtre. Elle se
 * ferme donc — et ne se rouvre que par un administrateur, motif à l'appui.
 */
describe('Site-tracking — verrouillage des commandes', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let conducteurId: string;
  let chantierId: string;

  function as(method: 'get' | 'post', path: string, who = userId) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', who);
  }

  async function commandeEnvoyee(): Promise<string> {
    const bc = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({}).expect(201)).body;
    await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({ nature: 'material', designation: 'Ciment', quantity: '10', unitPrice: '100' })
      .expect(201);
    await as('post', `/purchase-orders/${bc.id}/validate`).expect(201);
    return bc.id;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Verrou', 'admin', ['site_tracking']));
    // Un conducteur DANS LE MÊME tenant : il mène le chantier, mais ne rouvre pas une commande
    // envoyée. C'est la séparation des droits qu'on veut prouver, pas deux sociétés distinctes.
    conducteurId = await createUser(ds, tenantId, 'conducteur@verrou.test');
    await app.get(EntitlementsService).assignSeat(tenantId, 'site_tracking', conducteurId);
    await app.get(RbacService).assignRole(tenantId, conducteurId, 'conducteur');
    chantierId = (await as('post', '/chantiers').send({ name: 'Tour Nord' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('refuse_toute_modification_dune_commande_envoyee', async () => {
    const id = await commandeEnvoyee();
    await as('post', `/purchase-orders/${id}/lines`)
      .send({ nature: 'material', designation: 'Sable', quantity: '1', unitPrice: '50' })
      .expect(409);
    await as('post', `/purchase-orders/${id}/lines/nomenclature`)
      .send({ mode: 'reste' })
      .expect(400);
  });

  it('seul_un_administrateur_rouvre_et_le_motif_est_exige', async () => {
    const id = await commandeEnvoyee();

    // Le conducteur n'a pas ce droit, même avec un motif.
    await as('post', `/purchase-orders/${id}/reopen`, conducteurId)
      .send({ motif: 'erreur de quantité' })
      .expect(403);

    // L'administrateur non plus, s'il n'explique pas pourquoi.
    await as('post', `/purchase-orders/${id}/reopen`).send({}).expect(400);

    const rouverte = (await as('post', `/purchase-orders/${id}/reopen`)
      .send({ motif: 'Quantité erronée sur la ligne ciment' })
      .expect(201)).body;
    expect(rouverte.status).toBe('draft');
    expect(rouverte.validated_at).toBeNull();
    expect(rouverte.reopened_count).toBe(1);

    // Et la commande redevient modifiable.
    await as('post', `/purchase-orders/${id}/lines`)
      .send({ nature: 'material', designation: 'Sable', quantity: '1', unitPrice: '50' })
      .expect(201);
  });

  it('garde_la_trace_de_qui_a_valide_et_rouvert_avec_le_motif', async () => {
    const id = await commandeEnvoyee();
    await as('post', `/purchase-orders/${id}/reopen`).send({ motif: 'Prix renégocié' }).expect(201);

    const journal = (await as('get', `/purchase-orders/${id}/events`).expect(200)).body;
    expect(journal.map((e: { action: string }) => e.action)).toEqual(['reopened', 'validated']);
    expect(journal[0].motif).toBe('Prix renégocié');
    expect(journal[0].auteur_email).toBeTruthy();
  });

  it('refuse_de_rouvrir_une_commande_deja_receptionnee', async () => {
    const id = await commandeEnvoyee();
    await as('post', `/purchase-orders/${id}/delivery-notes`).send({}).expect(201);

    await as('post', `/purchase-orders/${id}/reopen`)
      .send({ motif: 'correction' })
      .expect(409);
  });
});
