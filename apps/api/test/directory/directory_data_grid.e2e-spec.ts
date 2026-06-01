import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Référentiel — data-grid (pagination / tri / recherche)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Grid'));

    for (const c of [
      { code: 'C1', name: 'Alpha BTP' },
      { code: 'C2', name: 'Beta Constructions' },
      { code: 'C3', name: 'Gamma Travaux' },
    ]) {
      await request(app.getHttpServer())
        .post('/clients')
        .set('Host', 'localhost')
        .set('X-Tenant-Id', tenantId)
        .set('X-User-Id', userId)
        .send(c)
        .expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  function listClients(qs: string) {
    return request(app.getHttpServer())
      .get(`/clients${qs}`)
      .set('Host', 'localhost')
      .set('X-Tenant-Id', tenantId)
      .set('X-User-Id', userId);
  }

  it('pagine et trie', async () => {
    const res = await listClients('?pageSize=2&sort=code&dir=ASC').expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(2);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows.map((r: { code: string }) => r.code)).toEqual(['C1', 'C2']);
  });

  it('filtre par recherche plein-texte', async () => {
    const res = await listClients('?search=beta').expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].code).toBe('C2');
  });

  it('ignore une colonne de tri non autorisée (anti-injection)', async () => {
    await listClients('?sort=%3Bdrop%20table').expect(200);
  });
});
