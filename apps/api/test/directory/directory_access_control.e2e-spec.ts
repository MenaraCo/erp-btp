import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser } from '../support/entitlements.helpers';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Référentiel — contrôle d’accès (capacité × permission)', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  function req(method: 'get' | 'post', path: string, tenantId: string, userId?: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path) : request(server).post(path);
    const r = base.set('Host', 'localhost').set('X-Tenant-Id', tenantId);
    return userId ? r.set('X-User-Id', userId) : r;
  }

  it('refuse (403) quand la capacité directory n’est pas active (module core inactif)', async () => {
    const tenant = await createTenant(ds, 'NoCap');
    const userId = await createUser(ds, tenant.id, 'u@nocap.test');
    // core module not activated -> capability "directory" inactive
    await req('get', '/clients', tenant.id, userId).expect(403);
  });

  it('un rôle viewer peut lire mais pas écrire (permission orthogonale)', async () => {
    const { tenantId, userId } = await entitleUser(app, ds, 'Viewer', 'viewer');
    await req('get', '/clients', tenantId, userId).expect(200);
    await req('post', '/clients', tenantId, userId)
      .send({ code: 'X1', name: 'Should fail' })
      .expect(403);
  });

  it('un rôle admin peut lire ET écrire', async () => {
    const { tenantId, userId } = await entitleUser(app, ds, 'AdminRw', 'admin');
    await req('get', '/clients', tenantId, userId).expect(200);
    await req('post', '/clients', tenantId, userId)
      .send({ code: 'X1', name: 'Created' })
      .expect(201);
  });
});
