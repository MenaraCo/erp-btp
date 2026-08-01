import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Invoicing 2.3 — avenants (rule #4 recodification)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let marcheId: string;

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
    ({ tenantId, userId } = await entitleUser(app, ds, 'Av', 'admin', ['estimating', 'invoicing']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mat = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'M', label: 'M', unit: 'u', nature: 'material', unitCost: '100' })
        .expect(201)
    ).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'AV-A', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1.1', designation: 'Lot 1', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    marcheId = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body.marche.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('crée un avenant : ligne recodifiée -AV1 et total marché augmenté', async () => {
    const before = (await as('get', `/marches/${marcheId}`).expect(200)).body;
    expect(before.marche.total_ht).toBe('1000.00'); // 10 * 100

    const avenant = (
      await as('post', `/marches/${marcheId}/avenants`)
        .send({ label: 'Travaux supplémentaires', lines: [{ code: '1.2', designation: 'Reprise', unit: 'u', quantite: '5', pu: '120' }] })
        .expect(201)
    ).body;
    expect(avenant.numero).toBe(1);
    expect(avenant.total_ht).toBe('600.00'); // 5 * 120

    const detail = (await as('get', `/avenants/${avenant.id}`).expect(200)).body;
    expect(detail.lines[0].code).toBe('1.2-AV1'); // recodification rule #4
    expect(detail.lines[0].avenant_id).toBe(avenant.id);

    const after = (await as('get', `/marches/${marcheId}`).expect(200)).body;
    expect(after.marche.total_ht).toBe('1600.00'); // 1000 + 600
    expect(after.lines).toHaveLength(2); // initial + avenant line
  });

  it('les lignes d’avenant entrent dans les situations à l’avancement', async () => {
    // marché + avenant = ligne initiale (10×100) + ligne avenant (5×120). Situation à 100%.
    const lines = (await as('get', `/marches/${marcheId}`).expect(200)).body.lines;
    const situation = (
      await as('post', `/marches/${marcheId}/situations`)
        .send({ lines: lines.map((l: { id: string }) => ({ marcheLineId: l.id, pctAvancement: '1' })) })
        .expect(201)
    ).body;
    expect(situation.cumul_ht).toBe('1600.00'); // couvre marché + avenant
  });
});
