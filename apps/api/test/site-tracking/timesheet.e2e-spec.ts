import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Site-tracking 3.4 — pointages MO', () => {
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

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Ts', 'admin', ['estimating', 'site_tracking', 'invoicing']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '40' })
        .expect(201)
    ).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'TS-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    chantierId = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body.chantier.id;
    lineId = (await as('get', `/chantiers/${chantierId}`).expect(200)).body.lines[0].id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('saisit des pointages valorisés et calcule le réalisé MO', async () => {
    const t1 = (
      await as('post', `/chantiers/${chantierId}/timesheets`)
        .send({ executionLineId: lineId, employee: 'Équipe A', date: '2026-06-02', hours: '8', hourlyCost: '42' })
        .expect(201)
    ).body;
    expect(t1.cost).toBe('336.00'); // 8 * 42

    await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ executionLineId: lineId, employee: 'Équipe A', date: '2026-06-03', hours: '6', hourlyCost: '42' })
      .expect(201);

    const summary = (await as('get', `/chantiers/${chantierId}/timesheets/summary`).expect(200)).body;
    expect(summary.totalHours).toBe('14.00'); // 8 + 6
    expect(summary.totalCost).toBe('588.00'); // 336 + 252
  });

  it('refuse une ligne d’exécution d’un autre chantier (400)', async () => {
    await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ executionLineId: '00000000-0000-0000-0000-000000000000', employee: 'X', date: '2026-06-02', hours: '1', hourlyCost: '1' })
      .expect(400);
  });
});
