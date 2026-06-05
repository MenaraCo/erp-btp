import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * M.4 — poser un ouvrage de bibliothèque copie son sous-détail en lignes ressource enfants
 * éditables (découplées). Éditer un composant ou la quantité de l'ouvrage met à jour le déboursé.
 */
describe('Estimating — sous-détail d’ouvrage copié & modifiable', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let ouvrageId: string;

  function as(method: 'get' | 'post' | 'put' | 'patch', path: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path)
      : method === 'put' ? request(server).put(path)
        : method === 'patch' ? request(server).patch(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'SD', 'admin', 'estimating'));
    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '40' }).expect(201)).body;
    const mat = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'BET', label: 'Béton', unit: 'm3', nature: 'material', unitCost: '100' }).expect(201)).body;
    // OUV = 2h MO (80) + 1 m3 béton (100) -> déboursé unitaire 180
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'Mur', unit: 'm2' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);
    ouvrageId = ouv.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('copie le sous-détail en lignes ressource éditables et agrège le déboursé', async () => {
    const created = (await as('post', '/affaires').send({ code: 'SD-1', name: 'A' }).expect(201)).body;
    const vId = created.version.id;

    const res = (await as('post', `/versions/${vId}/ouvrages`)
      .send({ ouvrageId, quantity: '10' }).expect(201)).body;
    expect(res.components).toHaveLength(2); // MO + Béton copiés
    expect(res.ouvrage.source_ouvrage_id).toBe(ouvrageId);

    // les composants sont des lignes ressource enfants
    const lines = (await as('get', `/versions/${vId}/lines`).expect(200)).body;
    const children = lines.filter((l: { parent_line_id: string }) => l.parent_line_id === res.ouvrage.id);
    expect(children).toHaveLength(2);
    expect(children.every((c: { type: string }) => c.type === 'ressource')).toBe(true);

    // déboursé = 180 × 10 = 1800 (labor 800, material 1000)
    let fv = (await as('get', `/versions/${vId}/sale-sheet`).expect(200)).body;
    expect(fv.totalDebourse).toBe('1800');

    // éditer le PU du béton (100 -> 150) : déboursé = (80 + 150) × 10 = 2300
    const beton = children.find((c: { code: string }) => c.code === 'BET');
    await as('patch', `/lines/${beton.id}`).send({ pu: '150' }).expect(200);
    fv = (await as('get', `/versions/${vId}/sale-sheet`).expect(200)).body;
    expect(fv.totalDebourse).toBe('2300');

    // changer la quantité de l'ouvrage (10 -> 5) : déboursé = 230 × 5 = 1150
    await as('patch', `/lines/${res.ouvrage.id}`).send({ quantity: '5' }).expect(200);
    fv = (await as('get', `/versions/${vId}/sale-sheet`).expect(200)).body;
    expect(fv.totalDebourse).toBe('1150');
  });

  it('applique la perte sur un composant', async () => {
    const created = (await as('post', '/affaires').send({ code: 'SD-2', name: 'B' }).expect(201)).body;
    const vId = created.version.id;
    const res = (await as('post', `/versions/${vId}/ouvrages`).send({ ouvrageId, quantity: '1' }).expect(201)).body;
    const beton = res.components.find((c: { code: string }) => c.code === 'BET');
    // perte 10 % sur le béton : déboursé = 80 + 100×1.1 = 190
    await as('patch', `/lines/${beton.id}`).send({ perte: '10' }).expect(200);
    const fv = (await as('get', `/versions/${vId}/sale-sheet`).expect(200)).body;
    expect(fv.totalDebourse).toBe('190');
  });
});
