import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Estimating 1.3 — corps de devis hiérarchique + métré', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

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
    ({ tenantId, userId } = await entitleUser(app, ds, 'Devis', 'admin', 'estimating'));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('crée une affaire avec sa version 1', async () => {
    const res = await as('post', '/affaires')
      .send({ code: 'AFF-1', name: 'Maison Dupont' })
      .expect(201);
    expect(res.body.affaire.id).toBeTruthy();
    expect(res.body.affaire.status).toBe('en_cours');
    expect(res.body.devis.status).toBe('open');
    expect(res.body.version.version_no).toBe(1);
  });

  it('construit un arbre Titre → Sous-titre → Ouvrage et calcule le métré par formule', async () => {
    const created = (
      await as('post', '/affaires').send({ code: 'AFF-2', name: 'Hangar' }).expect(201)
    ).body;
    const versionId = created.version.id;

    // global métré variables
    await as('put', `/versions/${versionId}/variables/longueur`).send({ value: 10 }).expect(200);
    await as('put', `/versions/${versionId}/variables/largeur`).send({ value: 4 }).expect(200);

    const titre = (
      await as('post', `/versions/${versionId}/lines`)
        .send({ type: 'titre', code: '1', designation: 'Gros œuvre', sortOrder: 1 })
        .expect(201)
    ).body;
    const sousTitre = (
      await as('post', `/versions/${versionId}/lines`)
        .send({ type: 'sous_titre', parentLineId: titre.id, designation: 'Dallage', sortOrder: 1 })
        .expect(201)
    ).body;
    const ouvrage = (
      await as('post', `/versions/${versionId}/lines`)
        .send({
          type: 'ouvrage',
          parentLineId: sousTitre.id,
          designation: 'Dalle béton',
          unit: 'm2',
          quantityFormula: 'longueur * largeur',
          sortOrder: 1,
        })
        .expect(201)
    ).body;
    expect(ouvrage.quantity).toBe('40.0000'); // 10 * 4

    // change a variable -> métré recomputed
    await as('put', `/versions/${versionId}/variables/largeur`).send({ value: 5 }).expect(200);
    const lines = (await as('get', `/versions/${versionId}/lines`).expect(200)).body;
    const dalle = lines.find((l: { id: string }) => l.id === ouvrage.id);
    expect(dalle.quantity).toBe('50.0000'); // 10 * 5

    // tree integrity
    expect(sousTitre.parent_line_id).toBe(titre.id);
    expect(dalle.parent_line_id).toBe(sousTitre.id);
  });

  it('refuse une formule de métré invalide (400)', async () => {
    const created = (
      await as('post', '/affaires').send({ code: 'AFF-3', name: 'X' }).expect(201)
    ).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', designation: 'bad', quantityFormula: '1 +' })
      .expect(400);
  });
});
