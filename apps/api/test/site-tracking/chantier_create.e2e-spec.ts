import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Chantier — création directe (écran frontend)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post', path: string) {
    const server = app.getHttpServer();
    const r = method === 'get' ? request(server).get(path) : request(server).post(path);
    return r.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'ChCreate', 'admin', ['site_tracking']));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('crée un chantier vide et le retrouve dans la liste', async () => {
    const created = (await as('post', '/chantiers').send({ code: 'CH-A', name: 'Chantier A' }).expect(201)).body;
    expect(created.code).toBe('CH-A');
    expect(created.status).toBe('open');

    const list = (await as('get', '/chantiers').expect(200)).body;
    expect(list.find((c: { id: string }) => c.id === created.id)).toBeTruthy();
  });

  it('refuse un code dupliqué (409) et un corps incomplet (400)', async () => {
    await as('post', '/chantiers').send({ code: 'CH-B', name: 'B' }).expect(201);
    await as('post', '/chantiers').send({ code: 'CH-B', name: 'B bis' }).expect(409);
    await as('post', '/chantiers').send({ code: 'CH-C' }).expect(400);
  });
});
