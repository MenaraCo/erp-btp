import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Cahier des charges §3.3: trial and direct subscription are TWO INDEPENDENT entry doors.
 * A client can subscribe and pay directly, without ever going through `trialing`.
 */
describe('Souscription — deux parcours indépendants (essai OU direct)', () => {
  let app: INestApplication;
  let ds: DataSource;

  function as(tenantId: string, userId: string, method: 'get' | 'post', path: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('Porte 2 — souscription directe : créée en `active`, sans passer par `trialing`', async () => {
    const { tenantId, userId } = await entitleUser(app, ds, 'Direct', 'admin', 'core');

    // No subscription yet (null -> empty body over HTTP).
    const before = (await as(tenantId, userId, 'get', '/subscription').expect(200)).body;
    expect(before?.status).toBeUndefined();

    const sub = (
      await as(tenantId, userId, 'post', '/subscription/direct')
        .send({ modules: [{ moduleCode: 'estimating', seats: 3 }] })
        .expect(201)
    ).body;
    expect(sub.status).toBe('active');
    expect(sub.trialEndsAt).toBeNull(); // jamais passé par trialing

    // Une seconde souscription directe est refusée.
    await as(tenantId, userId, 'post', '/subscription/direct')
      .send({ modules: [{ moduleCode: 'estimating', seats: 3 }] })
      .expect(409);
  });

  it('Porte 1 — essai : indépendante, crée une souscription `trialing`', async () => {
    const { tenantId, userId } = await entitleUser(app, ds, 'Trial', 'admin', 'core');
    const sub = (await as(tenantId, userId, 'post', '/subscription/trial').expect(201)).body;
    expect(sub.status).toBe('trialing');
    expect(sub.trialEndsAt).toBeTruthy();
  });
});
