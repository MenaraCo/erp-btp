import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Site-tracking 3.6 — résultats analytiques (budget / engagé / réalisé)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let lineId: string;

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

  const byNature = (rows: Record<string, string>[]): Record<string, Record<string, string>> =>
    Object.fromEntries(rows.map((r) => [r.nature, r]));

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'An', 'admin', ['estimating', 'site_tracking', 'invoicing']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (await as('post', `/libraries/${lib.id}/resources`).send({ code: 'MO', label: 'MO', unit: 'h', nature: 'labor', unitCost: '40' }).expect(201)).body;
    const mat = (await as('post', `/libraries/${lib.id}/resources`).send({ code: 'MAT', label: 'Mat', unit: 'm3', nature: 'material', unitCost: '100' }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'AN-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' }).expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' }).expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    chantierId = acc.chantier.id;
    await as('post', `/marches/${acc.marche.id}/contre-etude/validate`).expect(201);
    lineId = (await as('get', `/chantiers/${chantierId}`).expect(200)).body.lines[0].id;

    // réalisé MO via pointages : 10h × 42 = 420
    await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ executionLineId: lineId, employee: 'A', date: '2026-06-02', hours: '10', hourlyCost: '42' }).expect(201);
    // engagé matériaux via BC validé : 8 × 95 = 760
    const order = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({ code: 'BC-1' }).expect(201)).body;
    await as('post', `/purchase-orders/${order.id}/lines`).send({ nature: 'material', designation: 'Béton', quantity: '8', unitPrice: '95' }).expect(201);
    await as('post', `/purchase-orders/${order.id}/validate`).expect(201);
    // réalisé matériaux via facture : 700
    await as('post', `/purchase-orders/${order.id}/invoices`).send({ code: 'FF-1', nature: 'material', amountHt: '700' }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('synthétise budget / engagé / réalisé / écart par nature', async () => {
    const res = (await as('get', `/chantiers/${chantierId}/results`).expect(200)).body;
    const n = byNature(res.byNature);

    // labor : budget objectif 800 (2*40*10), réalisé 420 (pointages), engagé 0, écart 380
    expect(n.labor.budgetObjectif).toBe('800.00');
    expect(n.labor.realise).toBe('420.00');
    expect(n.labor.engage).toBe('0.00');
    expect(n.labor.ecart).toBe('380.00');

    // material : budget objectif 1000 (1*100*10), engagé 760, réalisé 700, écart 1000-(700+760) = -460
    expect(n.material.budgetObjectif).toBe('1000.00');
    expect(n.material.engage).toBe('760.00');
    expect(n.material.realise).toBe('700.00');
    expect(n.material.ecart).toBe('-460.00');
  });

  it('produit une amorce d’export comptable depuis les factures fournisseurs', async () => {
    const exp = (await as('get', `/chantiers/${chantierId}/accounting-export`).expect(200)).body;
    expect(exp.journal).toBe('ACH');
    expect(exp.entries).toHaveLength(1);
    expect(exp.entries[0].debit.account).toBe('601'); // matériaux
    expect(exp.entries[0].credit.account).toBe('401'); // fournisseurs
    expect(exp.entries[0].debit.amount).toBe('700.00');
  });
});
