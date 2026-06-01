import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Recherche universelle — référentiel (clients + fournisseurs)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Search'));

    const headers = (r: request.Test) =>
      r
        .set('Host', 'localhost')
        .set('X-Tenant-Id', tenantId)
        .set('X-User-Id', userId);

    await headers(request(app.getHttpServer()).post('/clients'))
      .send({ code: 'CL1', name: 'Acme Corp' })
      .expect(201);
    await headers(request(app.getHttpServer()).post('/suppliers'))
      .send({ code: 'SU1', name: 'Acme Supplies' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('retourne des résultats des deux types pour un terme commun', async () => {
    const res = await request(app.getHttpServer())
      .get('/search?q=acme')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', tenantId)
      .set('X-User-Id', userId)
      .expect(200);

    const types = res.body.map((h: { type: string }) => h.type).sort();
    expect(types).toEqual(['directory.client', 'directory.supplier']);
  });

  it('retourne une liste vide pour un terme vide', async () => {
    const res = await request(app.getHttpServer())
      .get('/search?q=')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', tenantId)
      .set('X-User-Id', userId)
      .expect(200);
    expect(res.body).toEqual([]);
  });
});
