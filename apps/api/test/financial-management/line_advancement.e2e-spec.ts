import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Avancement ouvrage par ouvrage (cahier §5.8) : le moteur consomme un avancement global effectif
 * = moyenne des avancements de ligne pondérée par le budget objectif (= Σ budget avancé / budget).
 */
describe('Financial — avancement ouvrage par ouvrage', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let lineA: string; // 800 (labor)
  let lineB: string; // 1000 (material)

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path)
      : method === 'put' ? request(server).put(path)
        : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }
  const round = (n: number) => Math.round(n * 100) / 100;

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'La', 'admin', ['estimating', 'site_tracking', 'invoicing', 'financial_management']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '40' }).expect(201)).body;
    const mat = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'MAT', label: 'Béton', unit: 'm3', nature: 'material', unitCost: '100' }).expect(201)).body;
    const oa = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'A', label: 'A', unit: 'u' }).expect(201)).body;
    const ob = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'B', label: 'B', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${oa.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    await as('post', `/ouvrages/${ob.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'LA-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Ouvrage A', sourceOuvrageId: oa.id, quantity: '10' }).expect(201);
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '2', designation: 'Ouvrage B', sourceOuvrageId: ob.id, quantity: '10' }).expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' }).expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    chantierId = acc.chantier.id;
    await as('post', `/marches/${acc.marche.id}/etude/validate`).expect(201);
    await as('post', `/marches/${acc.marche.id}/contre-etude/validate`).expect(201);
    const lines = (await as('get', `/chantiers/${chantierId}`)).body.lines;
    lineA = lines.find((l: { designation: string }) => l.designation === 'Ouvrage A').id;
    lineB = lines.find((l: { designation: string }) => l.designation === 'Ouvrage B').id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('avancement par ligne : moyenne pondérée par budget dans le forecast', async () => {
    // A (800) à 100 %, B (1000) à 0 % → pondéré = 800 / 1800 = 0,4444
    await as('post', `/chantiers/${chantierId}/line-advancement`).send({ executionLineId: lineA, pct: '1' }).expect(201);
    await as('post', `/chantiers/${chantierId}/line-advancement`).send({ executionLineId: lineB, pct: '0' }).expect(201);

    const f = (await as('get', `/chantiers/${chantierId}/forecast`).expect(200)).body;
    expect(Number(f.avancement)).toBeCloseTo(0.44444, 4);
    // budget avancé = 1800 × 0,4444 = 800 (= l'ouvrage A entièrement fait)
    expect(round(Number(f.indicators.budgetAvance))).toBe(800);
  });

  it('application en masse (global) : tous les ouvrages au même avancement', async () => {
    const lines = (await as('post', `/chantiers/${chantierId}/line-advancement/apply`).send({ pct: '0.5' }).expect(201)).body;
    expect(lines.length).toBe(2);
    const f = (await as('get', `/chantiers/${chantierId}/forecast`).expect(200)).body;
    expect(Number(f.avancement)).toBeCloseTo(0.5, 5);
    expect(round(Number(f.indicators.budgetAvance))).toBe(900); // 1800 × 0,5
  });

  it('liste l’avancement courant par ligne', async () => {
    const lines = (await as('get', `/chantiers/${chantierId}/line-advancement`).expect(200)).body as Array<{ execution_line_id: string; pct: string }>;
    expect(lines.length).toBe(2);
    expect(lines.every((l) => Number(l.pct) === 0.5)).toBe(true);
  });
});
