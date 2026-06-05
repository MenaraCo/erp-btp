import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Estimating 1.5 — workflow de devis (rule #7)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post', path: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  async function newDevis(code: string) {
    return (await as('post', '/affaires').send({ code, name: code }).expect(201)).body.devis;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Wf', 'admin', 'estimating'));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('suit le chemin nominal open -> ... -> won', async () => {
    const devis = await newDevis('WF-1');
    expect(devis.status).toBe('open');
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      const res = await as('post', `/devis/${devis.id}/transition`).send({ to }).expect(201);
      expect(res.body.devis.status).toBe(to);
    }
  });

  it('refuse (409) une transition non autorisée', async () => {
    const devis = await newDevis('WF-2');
    await as('post', `/devis/${devis.id}/transition`).send({ to: 'won' }).expect(409);
  });

  it('transfer-check : bloquant tant que non Gagné, ok une fois Gagné', async () => {
    const devis = await newDevis('WF-3');
    const before = (await as('get', `/devis/${devis.id}/transfer-check`).expect(200)).body;
    expect(before.transferable).toBe(false);
    expect(before.alerts.some((a: { level: string }) => a.level === 'blocking')).toBe(true);

    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/devis/${devis.id}/transition`).send({ to }).expect(201);
    }
    const after = (await as('get', `/devis/${devis.id}/transfer-check`).expect(200)).body;
    expect(after.transferable).toBe(true);
    // déboursé nul -> alerte non bloquante (warning)
    expect(after.alerts.some((a: { level: string }) => a.level === 'warning')).toBe(true);
    expect(after.alerts.some((a: { level: string }) => a.level === 'blocking')).toBe(false);
  });
});
