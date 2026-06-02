import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Gestion financière B.1 — paramètres versionnés + avancement', () => {
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

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Fm', 'admin', [
      'estimating',
      'site_tracking',
      'financial_management',
    ]));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (await as('post', `/libraries/${lib.id}/resources`).send({ code: 'MO', label: 'MO', unit: 'h', nature: 'labor', unitCost: '40' }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'FM-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`).send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' }).expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`).send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' }).expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/affaires/${created.affaire.id}/transition`).send({ to }).expect(201);
    }
    chantierId = (await as('post', `/affaires/${created.affaire.id}/transfer-to-chantier`).expect(201)).body.chantier.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('fournit un jeu de formules par défaut puis le versionne à la mise à jour', async () => {
    const v1 = (await as('get', '/financial/formula-set').expect(200)).body;
    expect(v1.version).toBe(1);
    expect(v1.eac_method).toBe('m1');

    const v2 = (
      await as('put', '/financial/formula-set').send({ eacMethod: 'm2', ecartAlertPct: '-0.08' }).expect(200)
    ).body;
    expect(v2.version).toBe(2);
    expect(v2.eac_method).toBe('m2');

    const active = (await as('get', '/financial/formula-set').expect(200)).body;
    expect(active.version).toBe(2);
    expect(active.eac_method).toBe('m2');
  });

  it('enregistre l’avancement global et par nature', async () => {
    await as('post', `/chantiers/${chantierId}/advancement`).send({ pct: '0.5' }).expect(201);
    await as('post', `/chantiers/${chantierId}/advancement`).send({ nature: 'labor', pct: '0.6' }).expect(201);

    const adv = (await as('get', `/chantiers/${chantierId}/advancement`).expect(200)).body;
    expect(adv.global.pct).toBe('0.5000');
    expect(adv.byNature).toHaveLength(1);
    expect(adv.byNature[0].nature).toBe('labor');
    expect(adv.byNature[0].pct).toBe('0.6000');
  });

  it('refuse un avancement hors [0,1] (400)', async () => {
    await as('post', `/chantiers/${chantierId}/advancement`).send({ pct: '1.5' }).expect(400);
  });
});
