import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Imputation analytique engagé/réalisé B.0d (§5.8)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let orderId: string;
  let familleId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get'
        ? request(server).get(path)
        : method === 'put'
          ? request(server).put(path)
          : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Imp', 'admin', [
      'estimating',
      'site_tracking',
      'invoicing',
    ]));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mat = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'MAT', label: 'Béton', unit: 'm3', nature: 'material', unitCost: '100' })
        .expect(201)
    ).body;
    const ouv = (
      await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)
    ).body;
    await as('post', `/ouvrages/${ouv.id}/components`)
      .send({ kind: 'resource', childResourceId: mat.id, quantity: '1' })
      .expect(201);
    const created = (await as('post', '/affaires').send({ code: 'IMP-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/affaires/${created.affaire.id}/transition`).send({ to }).expect(201);
    }
    chantierId = (await as('post', `/affaires/${created.affaire.id}/accept`).expect(201)).body.chantier.id;

    const tree = (await as('get', '/analytical/plan').expect(200)).body;
    familleId = tree.find((n: { nature: string }) => n.nature === 'material').lots[0].familles[0].id;

    const ddp = (await as('post', `/chantiers/${chantierId}/purchase-requests`).send({ code: 'DDP' }).expect(201)).body;
    orderId = (await as('post', `/purchase-requests/${ddp.id}/convert`).send({ code: 'BC' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('impute une ligne de commande (engagé) à une famille analytique', async () => {
    const line = (
      await as('post', `/purchase-orders/${orderId}/lines`)
        .send({
          nature: 'material',
          designation: 'Béton',
          quantity: '10',
          unitPrice: '95',
          familleAnalytiqueId: familleId,
        })
        .expect(201)
    ).body;
    expect(line.famille_analytique_id).toBe(familleId);
  });

  it('impute une facture fournisseur (réalisé) à une famille analytique', async () => {
    await as('post', `/purchase-orders/${orderId}/validate`).expect(201);
    await as('post', `/purchase-orders/${orderId}/delivery-notes`).send({ code: 'BL' }).expect(201);
    const inv = (
      await as('post', `/purchase-orders/${orderId}/invoices`)
        .send({ code: 'F1', nature: 'material', amountHt: '900', familleAnalytiqueId: familleId })
        .expect(201)
    ).body;
    expect(inv.famille_analytique_id).toBe(familleId);
  });

  it('refuse une famille inexistante sur une ligne de commande (404)', async () => {
    const ddp = (await as('post', `/chantiers/${chantierId}/purchase-requests`).send({ code: 'DDP2' }).expect(201)).body;
    const order2 = (await as('post', `/purchase-requests/${ddp.id}/convert`).send({ code: 'BC2' }).expect(201)).body;
    await as('post', `/purchase-orders/${order2.id}/lines`)
      .send({
        nature: 'material',
        designation: 'X',
        quantity: '1',
        unitPrice: '1',
        familleAnalytiqueId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(404);
  });
});
