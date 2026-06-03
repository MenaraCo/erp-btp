import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Classification analytique des ressources B.0b (§5.8)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let libraryId: string;
  let familleId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get'
        ? request(server).get(path)
        : method === 'put'
          ? request(server).put(path)
          : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Cls', 'admin', ['estimating']));
    libraryId = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body.id;

    const tree = (await as('get', '/analytical/plan').expect(200)).body;
    const material = tree.find((n: { nature: string }) => n.nature === 'material');
    familleId = material.lots[0].familles[0].id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('crée une ressource directement classée sur une famille', async () => {
    const res = (
      await as('post', `/libraries/${libraryId}/resources`)
        .send({
          code: '280',
          label: 'Colle',
          unit: 'kg',
          nature: 'material',
          unitCost: '12',
          familleAnalytiqueId: familleId,
        })
        .expect(201)
    ).body;
    expect(res.familleAnalytiqueId).toBe(familleId);
  });

  it('classe a posteriori une ressource non classée', async () => {
    const res = (
      await as('post', `/libraries/${libraryId}/resources`)
        .send({ code: '281', label: 'Sable', unit: 'm3', nature: 'material', unitCost: '40' })
        .expect(201)
    ).body;
    expect(res.familleAnalytiqueId).toBeNull();

    const classified = (
      await as('put', `/libraries/${libraryId}/resources/${res.id}/famille`)
        .send({ familleAnalytiqueId: familleId })
        .expect(200)
    ).body;
    expect(classified.famille_analytique_id).toBe(familleId);
  });

  it('refuse une famille inexistante (404)', async () => {
    const res = (
      await as('post', `/libraries/${libraryId}/resources`)
        .send({ code: '282', label: 'Gravier', unit: 'm3', nature: 'material', unitCost: '35' })
        .expect(201)
    ).body;
    await as('put', `/libraries/${libraryId}/resources/${res.id}/famille`)
      .send({ familleAnalytiqueId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);
  });
});
