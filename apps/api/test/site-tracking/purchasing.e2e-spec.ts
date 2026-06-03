import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Site-tracking 3.5 — chaîne des achats (DDP→BC→BL→facture)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;

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

  const byNature = (rows: { nature: string; montant: string }[]) =>
    Object.fromEntries(rows.map((r) => [r.nature, r.montant]));

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Pu', 'admin', ['estimating', 'site_tracking', 'invoicing']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mat = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'MAT', label: 'Béton', unit: 'm3', nature: 'material', unitCost: '100' })
        .expect(201)
    ).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'PU-1', name: 'A' }).expect(201)).body;
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
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('engagé compté seulement à la validation du BC ; réalisé depuis la facture', async () => {
    // DDP -> BC
    const ddp = (await as('post', `/chantiers/${chantierId}/purchase-requests`).send({ code: 'DDP-1' }).expect(201)).body;
    const order = (await as('post', `/purchase-requests/${ddp.id}/convert`).send({ code: 'BC-1' }).expect(201)).body;

    await as('post', `/purchase-orders/${order.id}/lines`)
      .send({ nature: 'material', designation: 'Béton', quantity: '10', unitPrice: '95' })
      .expect(201);

    // BC en brouillon -> engagé = 0
    let summary = (await as('get', `/chantiers/${chantierId}/purchasing-summary`).expect(200)).body;
    expect(summary.engageTotal).toBe('0.00');

    // Validation -> engagé = 950 (10 * 95)
    await as('post', `/purchase-orders/${order.id}/validate`).expect(201);
    summary = (await as('get', `/chantiers/${chantierId}/purchasing-summary`).expect(200)).body;
    expect(summary.engageTotal).toBe('950.00');
    expect(byNature(summary.engageByNature).material).toBe('950.00');

    // BL puis facture fournisseur -> réalisé = 900
    await as('post', `/purchase-orders/${order.id}/delivery-notes`).send({ code: 'BL-1' }).expect(201);
    await as('post', `/purchase-orders/${order.id}/invoices`)
      .send({ code: 'FF-1', nature: 'material', amountHt: '900' })
      .expect(201);
    summary = (await as('get', `/chantiers/${chantierId}/purchasing-summary`).expect(200)).body;
    expect(summary.realiseTotal).toBe('900.00');
    expect(byNature(summary.realiseByNature).material).toBe('900.00');
  });

  it('annuler un BC validé retire l’engagé', async () => {
    const order = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({ code: 'BC-2' }).expect(201)).body;
    await as('post', `/purchase-orders/${order.id}/lines`)
      .send({ nature: 'equipment', designation: 'Location', quantity: '2', unitPrice: '300' })
      .expect(201);
    await as('post', `/purchase-orders/${order.id}/validate`).expect(201);
    let summary = (await as('get', `/chantiers/${chantierId}/purchasing-summary`).expect(200)).body;
    expect(byNature(summary.engageByNature).equipment).toBe('600.00');

    await as('post', `/purchase-orders/${order.id}/cancel`).expect(201);
    summary = (await as('get', `/chantiers/${chantierId}/purchasing-summary`).expect(200)).body;
    expect(byNature(summary.engageByNature).equipment).toBeUndefined(); // plus engagé
  });
});
