import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Directory CRUD — édition + suppression douce (écrans frontend)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post' | 'patch' | 'delete', path: string, tId = tenantId, uId = userId) {
    const server = app.getHttpServer();
    const r =
      method === 'get' ? request(server).get(path)
        : method === 'post' ? request(server).post(path)
          : method === 'patch' ? request(server).patch(path)
            : request(server).delete(path);
    return r.set('Host', 'localhost').set('X-Tenant-Id', tId).set('X-User-Id', uId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Dir', 'admin', ['core']));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('crée, édite puis supprime (soft) un client ; la liste reflète chaque action', async () => {
    const created = (await as('post', '/clients').send({ code: 'C1', name: 'Client 1' }).expect(201)).body;
    expect(created.id).toBeTruthy();

    const updated = (
      await as('patch', `/clients/${created.id}`).send({ code: 'C1', name: 'Client 1 Modifié' }).expect(200)
    ).body;
    expect(updated.name).toBe('Client 1 Modifié');

    await as('delete', `/clients/${created.id}`).expect(200);
    const list = (await as('get', '/clients?pageSize=100').expect(200)).body;
    expect(list.rows.find((r: { id: string }) => r.id === created.id)).toBeUndefined();
  });

  it('édite/supprime un fournisseur', async () => {
    const sup = (await as('post', '/suppliers').send({ code: 'S1', name: 'Fournisseur 1' }).expect(201)).body;
    await as('patch', `/suppliers/${sup.id}`).send({ code: 'S1', name: 'Fournisseur Modifié' }).expect(200);
    await as('delete', `/suppliers/${sup.id}`).expect(200);
  });

  it('404 sur édition/suppression d’un id inconnu', async () => {
    const ghost = '00000000-0000-0000-0000-000000000000';
    await as('patch', `/clients/${ghost}`).send({ code: 'X', name: 'X' }).expect(404);
    await as('delete', `/clients/${ghost}`).expect(404);
  });

  it('refuse sans permission directory.write (403)', async () => {
    const viewer = await entitleUser(app, ds, 'DirViewer', 'viewer', ['core']);
    await as('post', '/clients', viewer.tenantId, viewer.userId).send({ code: 'Z', name: 'Z' }).expect(403);
  });
});
