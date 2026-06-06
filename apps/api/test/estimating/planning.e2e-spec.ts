import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Estimating — planning des études (devis)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post' | 'patch', path: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path)
      : method === 'patch' ? request(server).patch(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Plan', 'admin', 'estimating'));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('PATCH planning partiel : chaque champ persiste sans écraser les autres', async () => {
    const created = (await as('post', '/affaires').send({ code: 'PL-1', name: 'A' }).expect(201)).body;
    const devisId = created.devis.id;

    // patchs séparés (comme la page planning)
    await as('patch', `/devis/${devisId}/planning`).send({ responsable: 'A. Martin' }).expect(200);
    await as('patch', `/devis/${devisId}/planning`).send({ dateDebut: '2026-06-09' }).expect(200);
    await as('patch', `/devis/${devisId}/planning`).send({ dateEcheance: '2026-07-01' }).expect(200);
    await as('patch', `/devis/${devisId}/planning`).send({ priorite: 'urgente' }).expect(200);

    const list = (await as('get', '/devis').expect(200)).body;
    const d = list.find((x: { id: string }) => x.id === devisId);
    expect(d.responsable).toBe('A. Martin');
    expect(d.priorite).toBe('urgente');
    expect(String(d.date_debut).slice(0, 10)).toBe('2026-06-09');
    expect(String(d.date_echeance).slice(0, 10)).toBe('2026-07-01');
  });
});
