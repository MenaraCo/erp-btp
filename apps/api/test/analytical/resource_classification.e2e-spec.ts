import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Classification analytique des ressources → code analytique (§5.8)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let libraryId: string;
  let codeId: string;

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
    const fam = tree
      .find((n: { nature: string }) => n.nature === 'material')
      .lots.flatMap((l: { familles: unknown[] }) => l.familles)
      .find((f: { codes: unknown[] }) => f.codes.length > 0);
    codeId = fam.codes[0].id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('crée une ressource directement rattachée à un code analytique', async () => {
    const res = (
      await as('post', `/libraries/${libraryId}/resources`)
        .send({
          code: 'P-280',
          label: 'Colle C2 Bostik 25kg',
          unit: 'kg',
          nature: 'material',
          unitCost: '12',
          codeAnalytiqueId: codeId,
        })
        .expect(201)
    ).body;
    expect(res.codeAnalytiqueId).toBe(codeId);
    expect(res.codeProduit).toBe('P-280');
  });

  it('classe a posteriori une ressource non classée', async () => {
    const res = (
      await as('post', `/libraries/${libraryId}/resources`)
        .send({ code: 'P-281', label: 'Sable', unit: 'm3', nature: 'material', unitCost: '40' })
        .expect(201)
    ).body;
    expect(res.codeAnalytiqueId).toBeNull();

    const classified = (
      await as('put', `/libraries/${libraryId}/resources/${res.id}/code-analytique`)
        .send({ codeAnalytiqueId: codeId })
        .expect(200)
    ).body;
    expect(classified.code_analytique_id).toBe(codeId);
  });

  it('refuse un code analytique inexistant (404)', async () => {
    const res = (
      await as('post', `/libraries/${libraryId}/resources`)
        .send({ code: 'P-282', label: 'Gravier', unit: 'm3', nature: 'material', unitCost: '35' })
        .expect(201)
    ).body;
    await as('put', `/libraries/${libraryId}/resources/${res.id}/code-analytique`)
      .send({ codeAnalytiqueId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);
  });
});
