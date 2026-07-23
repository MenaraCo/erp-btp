import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Site-tracking 3.3 — budget prévisionnel', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let marcheId: string;
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

  const byNature = (body: { budgetByNature: Record<string, string>[] }, key: string) =>
    Object.fromEntries(body.budgetByNature.map((b) => [b.nature, b[key]]));

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Bp', 'admin', ['estimating', 'site_tracking', 'invoicing']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '40' })
        .expect(201)
    ).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'BP-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    chantierId = acc.chantier.id;
    marcheId = acc.marche.id;
    lineId = (await as('get', `/chantiers/${chantierId}`).expect(200)).body.lines[0].id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('refuse d’ajuster le prévisionnel avant validation de la contre-étude (409)', async () => {
    await as('put', `/execution-lines/${lineId}/budget/labor`).send({ montantPrevisionnel: '900' }).expect(409);
  });

  it('initialise le prévisionnel depuis l’objectif à la validation, puis l’ajuste', async () => {
    await as('post', `/marches/${marcheId}/etude/validate`).expect(201);
    const validated = (await as('post', `/marches/${marcheId}/contre-etude/validate`).expect(201)).body;
    // objectif labor = 2 * 40 * 10 = 800 ; prévisionnel initialisé = 800
    expect(byNature(validated, 'objectif').labor).toBe('800.00');
    expect(byNature(validated, 'previsionnel').labor).toBe('800.00');

    const adjusted = (
      await as('put', `/execution-lines/${lineId}/budget/labor`).send({ montantPrevisionnel: '900' }).expect(200)
    ).body;
    expect(byNature(adjusted, 'previsionnel').labor).toBe('900.00');
    // étude et objectif inchangés
    expect(byNature(adjusted, 'etude').labor).toBe('800.00');
    expect(byNature(adjusted, 'objectif').labor).toBe('800.00');
  });
});
