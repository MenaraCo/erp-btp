import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Calcul Appro : agrège les ressources du devis et convertit la quantité d'emploi en quantité
 * d'achat (coeff de conversion), valorisée au prix catalogue.
 */
describe('Estimating — calcul appro', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path)
      : method === 'put' ? request(server).put(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Appro', 'admin', 'estimating'));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('convertit la quantité d’emploi en quantité d’achat via le coeff', async () => {
    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    // SAC : déboursé 3/sac ; 1 palette = 40 sacs ; prix catalogue 120/palette
    const sac = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'SAC', label: 'Sac ciment', unit: 'sac', nature: 'material', unitCost: '3', uniteAchat: 'palette', coeffConversion: '40', prixPublic: '120' })
      .expect(201)).body;
    // ouvrage : 2 sacs / unité d'ouvrage
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: sac.id, quantity: '2' }).expect(201);

    const created = (await as('post', '/affaires').send({ code: 'AP-1', name: 'A' }).expect(201)).body;
    // pose l'ouvrage × 50 → 50 × 2 = 100 sacs d'emploi
    await as('post', `/versions/${created.version.id}/ouvrages`).send({ ouvrageId: ouv.id, quantity: '50' }).expect(201);

    const appro = (await as('get', `/versions/${created.version.id}/appro`).expect(200)).body;
    expect(appro).toHaveLength(1);
    const r = appro[0];
    expect(r.code).toBe('SAC');
    expect(Number(r.qteEmploi)).toBe(100);
    expect(r.uniteAchat).toBe('palette');
    expect(Number(r.qteAppro)).toBe(2.5); // 100 / 40
    expect(Number(r.montant)).toBe(300); // 2.5 × 120
  });
});
