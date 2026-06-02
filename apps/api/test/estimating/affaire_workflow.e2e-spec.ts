import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Estimating 1.5 — workflow d’affaire (rule #7)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post', path: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  async function newAffaire(code: string) {
    return (await as('post', '/affaires').send({ code, name: code }).expect(201)).body.affaire;
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
    const affaire = await newAffaire('WF-1');
    expect(affaire.status).toBe('open');
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      const res = await as('post', `/affaires/${affaire.id}/transition`).send({ to }).expect(201);
      expect(res.body.affaire.status).toBe(to);
    }
  });

  it('refuse (409) une transition non autorisée', async () => {
    const affaire = await newAffaire('WF-2');
    await as('post', `/affaires/${affaire.id}/transition`).send({ to: 'won' }).expect(409);
  });

  it('transfer-check : bloquant tant que non Gagnée, ok une fois Gagnée', async () => {
    const affaire = await newAffaire('WF-3');
    const before = (await as('get', `/affaires/${affaire.id}/transfer-check`).expect(200)).body;
    expect(before.transferable).toBe(false);
    expect(before.alerts.some((a: { level: string }) => a.level === 'blocking')).toBe(true);

    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/affaires/${affaire.id}/transition`).send({ to }).expect(201);
    }
    const after = (await as('get', `/affaires/${affaire.id}/transfer-check`).expect(200)).body;
    expect(after.transferable).toBe(true);
    // déboursé nul -> alerte non bloquante (warning)
    expect(after.alerts.some((a: { level: string }) => a.level === 'warning')).toBe(true);
    expect(after.alerts.some((a: { level: string }) => a.level === 'blocking')).toBe(false);
  });
});
