import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Invoicing 2.2 — situations à l’avancement (rule #6)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let marcheId: string;
  let marcheLineId: string;

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
    ({ tenantId, userId } = await entitleUser(app, ds, 'Sit', 'admin', ['estimating', 'invoicing']));

    // Build a costed affaire -> win -> transfer to marché (1 line: qty 10 @ PU 100 -> 1000 HT).
    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mat = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'M', label: 'M', unit: 'u', nature: 'material', unitCost: '100' })
        .expect(201)
    ).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'S-1', name: 'S' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', designation: 'L', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const transfer = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    marcheId = transfer.marche.id;
    marcheLineId = (await as('get', `/marches/${marcheId}`).expect(200)).body.lines[0].id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('situation 1 à 50% puis situation 2 à 80% (déduction des antérieures)', async () => {
    const s1 = (
      await as('post', `/marches/${marcheId}/situations`)
        .send({ lines: [{ marcheLineId, pctAvancement: '0.5' }] })
        .expect(201)
    ).body;
    expect(s1.numero).toBe(1);
    expect(s1.cumul_ht).toBe('500.00');
    expect(s1.montant_periode_ht).toBe('500.00');
    expect(s1.retenue_garantie).toBe('25.00'); // 5%
    expect(s1.nap).toBe('575.00'); // TTC 600 - 25

    const s2 = (
      await as('post', `/marches/${marcheId}/situations`)
        .send({ lines: [{ marcheLineId, pctAvancement: '0.8' }] })
        .expect(201)
    ).body;
    expect(s2.numero).toBe(2);
    expect(s2.cumul_ht).toBe('800.00');
    expect(s2.montant_periode_ht).toBe('300.00'); // 800 - 500
    expect(s2.ttc).toBe('360.00');

    const list = (await as('get', `/marches/${marcheId}/situations`).expect(200)).body;
    expect(list).toHaveLength(2);
  });
});
