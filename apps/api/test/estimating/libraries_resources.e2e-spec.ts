import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Estimating 1.1 — bibliothèques & ressources', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    // estimating.bid capability comes from the "estimating" module.
    ({ tenantId, userId } = await entitleUser(app, ds, 'Estim', 'admin', 'estimating'));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  function as(method: 'get' | 'post', path: string, uid = userId) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', uid);
  }

  it('crée une bibliothèque puis y ajoute des ressources', async () => {
    const lib = await as('post', '/libraries')
      .send({ code: 'LIB1', name: 'Bibliothèque gros œuvre' })
      .expect(201);
    const libraryId = lib.body.id;
    expect(libraryId).toBeTruthy();

    await as('post', `/libraries/${libraryId}/resources`)
      .send({ code: 'MO-MACON', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '38.5000' })
      .expect(201);
    await as('post', `/libraries/${libraryId}/resources`)
      .send({ code: 'MAT-BETON', label: 'Béton C25/30', unit: 'm3', nature: 'material', unitCost: '120.0000' })
      .expect(201);

    const list = await as('get', `/libraries/${libraryId}/resources?sort=code&dir=ASC`).expect(200);
    expect(list.body.total).toBe(2);
    expect(list.body.rows.map((r: { code: string }) => r.code)).toEqual(['MAT-BETON', 'MO-MACON']);
  });

  it('valide la nature de la ressource', async () => {
    const lib = await as('post', '/libraries').send({ code: 'LIB2', name: 'Lib 2' }).expect(201);
    await as('post', `/libraries/${lib.body.id}/resources`)
      .send({ code: 'X', label: 'X', unit: 'u', nature: 'invalid', unitCost: '1' })
      .expect(400);
  });

  it('refuse (403) sans la capacité estimating (module non actif)', async () => {
    // A user entitled only to "core" lacks the estimating capability.
    const other = await entitleUser(app, ds, 'OnlyCore', 'admin', 'core');
    await request(app.getHttpServer())
      .get('/libraries')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', other.tenantId)
      .set('X-User-Id', other.userId)
      .expect(403);
  });
});
