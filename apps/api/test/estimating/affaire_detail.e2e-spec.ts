import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Estimating — lecture d’une affaire avec ses versions (détail devis)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post', path: string, tId = tenantId, uId = userId) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tId).set('X-User-Id', uId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Detail', 'admin', 'estimating'));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('retourne l’affaire et ses versions', async () => {
    const created = (await as('post', '/affaires').send({ code: 'D-1', name: 'Villa' }).expect(201)).body;
    await as('post', `/affaires/${created.affaire.id}/versions`).send({ label: 'v2' }).expect(201);

    const detail = (await as('get', `/affaires/${created.affaire.id}`).expect(200)).body;
    expect(detail.affaire.code).toBe('D-1');
    expect(detail.versions).toHaveLength(2);
    expect(detail.versions[0].version_no).toBe(1);
    expect(detail.versions[1].version_no).toBe(2);
  });

  it('refuse l’accès sans le module Études de prix (403)', async () => {
    const created = (await as('post', '/affaires').send({ code: 'D-2', name: 'X' }).expect(201)).body;
    const other = await entitleUser(app, ds, 'NoEstimDetail', 'admin', ['core']);
    await as('get', `/affaires/${created.affaire.id}`, other.tenantId, other.userId).expect(403);
  });
});
