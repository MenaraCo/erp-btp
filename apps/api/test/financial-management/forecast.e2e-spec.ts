import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Prévisionnel de chantier B.3 — moteur d’indicateurs branché (§5.8)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get' ? request(server).get(path)
        : method === 'put' ? request(server).put(path)
          : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Fc', 'admin', [
      'estimating',
      'site_tracking',
      'invoicing',
      'financial_management',
    ]));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (await as('post', `/libraries/${lib.id}/resources`).send({ code: 'MO', label: 'MO', unit: 'h', nature: 'labor', unitCost: '40' }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'FC-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' }).expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: { tauxFg: '50', tauxBenefice: '0' }, material: { tauxFg: '0', tauxBenefice: '0' }, equipment: { tauxFg: '0', tauxBenefice: '0' }, subcontract: { tauxFg: '0', tauxBenefice: '0' } }, tvaRate: '0.20' }).expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    chantierId = acc.chantier.id;
    // contre-étude validée → prévisionnel initialisé = objectif (800 labor)
    await as('post', `/marches/${acc.marche.id}/contre-etude/validate`).expect(201);
    // avancement global 50 %
    await as('post', `/chantiers/${chantierId}/advancement`).send({ pct: '0.5' }).expect(201);
    // engagé 200 (BC validé) + réalisé 150 (facture)
    const order = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({ code: 'BC' }).expect(201)).body;
    await as('post', `/purchase-orders/${order.id}/lines`).send({ nature: 'material', designation: 'X', quantity: '1', unitPrice: '200' }).expect(201);
    await as('post', `/purchase-orders/${order.id}/validate`).expect(201);
    await as('post', `/purchase-orders/${order.id}/delivery-notes`).send({ code: 'BL' }).expect(201);
    await as('post', `/purchase-orders/${order.id}/invoices`).send({ code: 'FF', nature: 'material', amountHt: '150' }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('assemble les 4 axes + avancement et calcule les indicateurs', async () => {
    const res = (await as('get', `/chantiers/${chantierId}/forecast`).expect(200)).body;
    // vente=1200 (80×1.5×10), budget=800, prévisionnel=800, engagé=200, réalisé=150, avancement=0.5
    expect(res.inputs.vente).toBe('1200.00');
    expect(res.inputs.budget).toBe('800.00');
    expect(res.inputs.engage).toBe('200.00');
    expect(res.inputs.realise).toBe('150.00');
    expect(res.avancement).toBe('0.5000');

    const i = res.indicators;
    expect(i.budgetAvance).toBe('400.00'); // 800 × 0.5
    expect(i.ecartAuStade).toBe('50.00'); // 400 − (150 + 200)
    expect(i.eac).toBe('800.00'); // m1 (défaut) = réalisé + reste à dépenser = prévisionnel
    expect(i.margePrevisionnelle).toBe('400.00'); // 1200 − 800
    expect(i.cpi).toBe('2.6667'); // 400 / 150
    expect(i.alerts).not.toContain('marge'); // marge 33% > cible 5%
  });

  it('refuse l’accès sans le module Gestion financière (403)', async () => {
    const other = await entitleUser(app, ds, 'FcNo', 'admin', ['estimating', 'site_tracking', 'invoicing']);
    await request(app.getHttpServer())
      .get(`/chantiers/${chantierId}/forecast`)
      .set('Host', 'localhost').set('X-Tenant-Id', other.tenantId).set('X-User-Id', other.userId)
      .expect(403);
  });
});
