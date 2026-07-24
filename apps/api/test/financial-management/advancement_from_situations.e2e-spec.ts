import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Avancement dérivé des situations (cahier §5.8, mode « situations ») : le % cumulé d'une situation
 * est repris comme PROPOSITION d'avancement d'exécution, puis reste librement modifiable.
 */
describe('Financial — avancement repris des situations (non figé)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let marcheId: string;
  let execLineId: string;
  let marcheLineId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path)
      : method === 'put' ? request(server).put(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }
  const pctOf = (lines: Array<{ execution_line_id: string; pct: string }>, id: string) =>
    Number(lines.find((l) => l.execution_line_id === id)?.pct ?? -1);

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Sa', 'admin', ['estimating', 'site_tracking', 'invoicing', 'financial_management']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '40' }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'SA-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Ouvrage', sourceOuvrageId: ouv.id, quantity: '10' }).expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' }).expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    chantierId = acc.chantier.id; marcheId = acc.marche.id;
    await as('post', `/marches/${marcheId}/etude/validate`).expect(201);
    await as('post', `/marches/${marcheId}/contre-etude/validate`).expect(201);
    execLineId = (await as('get', `/chantiers/${chantierId}`)).body.lines[0].id;
    marcheLineId = (await as('get', `/marches/${marcheId}`)).body.lines.find((l: { type: string }) => l.type === 'ouvrage').id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('reprend le % cumulé de la situation sur l’ouvrage d’exécution correspondant', async () => {
    // Situation à 60 % sur l'ouvrage
    await as('post', `/marches/${marcheId}/situations`)
      .send({ retenueRate: '0', tvaRate: '0.2', lines: [{ marcheLineId, pctAvancement: '0.6' }] }).expect(201);

    const applied = (await as('post', `/chantiers/${chantierId}/line-advancement/from-situations`).expect(201)).body;
    expect(pctOf(applied, execLineId)).toBeCloseTo(0.6, 5);
  });

  it('le % repris n’est PAS figé : il peut être modifié côté avancement', async () => {
    await as('post', `/chantiers/${chantierId}/line-advancement`)
      .send({ executionLineId: execLineId, pct: '0.8' }).expect(201);
    const lines = (await as('get', `/chantiers/${chantierId}/line-advancement`).expect(200)).body;
    expect(pctOf(lines, execLineId)).toBeCloseTo(0.8, 5);
  });
});
