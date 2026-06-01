import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Estimating 1.2 — ouvrage composé + recalcul ascendant (DB)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let libraryId: string;
  let macon: string; // MO resource id
  let beton: string; // material resource id

  function as(method: 'get' | 'post' | 'patch', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get'
        ? request(server).get(path)
        : method === 'patch'
          ? request(server).patch(path)
          : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Ouvrage', 'admin', 'estimating'));

    const lib = await as('post', '/libraries').send({ code: 'L', name: 'Lib' }).expect(201);
    libraryId = lib.body.id;
    const m = await as('post', `/libraries/${libraryId}/resources`)
      .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '38.5' })
      .expect(201);
    macon = m.body.id;
    const b = await as('post', `/libraries/${libraryId}/resources`)
      .send({ code: 'BET', label: 'Béton', unit: 'm3', nature: 'material', unitCost: '120' })
      .expect(201);
    beton = b.body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('compose un ouvrage et calcule son déboursé, puis recalcule en cascade', async () => {
    // SEMELLE = 1.05*120 + 2.5*38.5 + 3% = 228.9175
    const semelle = (
      await as('post', `/libraries/${libraryId}/ouvrages`)
        .send({ code: 'SEMELLE', label: 'Semelle', unit: 'm3' })
        .expect(201)
    ).body;
    await as('post', `/ouvrages/${semelle.id}/components`)
      .send({ kind: 'resource', childResourceId: beton, quantity: '1.05' })
      .expect(201);
    await as('post', `/ouvrages/${semelle.id}/components`)
      .send({ kind: 'resource', childResourceId: macon, quantity: '2.5' })
      .expect(201);
    const semelleAfterPct = await as('post', `/ouvrages/${semelle.id}/components`)
      .send({ kind: 'percentage', rate: '0.03' })
      .expect(201);
    expect(semelleAfterPct.body.debourse).toBe('228.9175');

    // FONDATION = 4*SEMELLE + 3*MO = 1031.17
    const fondation = (
      await as('post', `/libraries/${libraryId}/ouvrages`)
        .send({ code: 'FONDATION', label: 'Fondation', unit: 'm3' })
        .expect(201)
    ).body;
    await as('post', `/ouvrages/${fondation.id}/components`)
      .send({ kind: 'sub_ouvrage', childOuvrageId: semelle.id, quantity: '4' })
      .expect(201);
    const fondationFull = await as('post', `/ouvrages/${fondation.id}/components`)
      .send({ kind: 'resource', childResourceId: macon, quantity: '3' })
      .expect(201);
    expect(fondationFull.body.debourse).toBe('1031.1700');

    // Change the MO price 38.5 -> 42 : both ouvrages recompute upward.
    await as('patch', `/libraries/${libraryId}/resources/${macon}`)
      .send({ unitCost: '42' })
      .expect(200);

    const semelleNow = await as('get', `/ouvrages/${semelle.id}`).expect(200);
    expect(semelleNow.body.debourse).toBe('237.9300');
    const fondationNow = await as('get', `/ouvrages/${fondation.id}`).expect(200);
    expect(fondationNow.body.debourse).toBe('1077.7200');
  });

  it('refuse (400) un cycle de composition', async () => {
    const a = (
      await as('post', `/libraries/${libraryId}/ouvrages`)
        .send({ code: 'CYC-A', label: 'A', unit: 'u' })
        .expect(201)
    ).body;
    const b = (
      await as('post', `/libraries/${libraryId}/ouvrages`)
        .send({ code: 'CYC-B', label: 'B', unit: 'u' })
        .expect(201)
    ).body;
    // A contains B (ok)
    await as('post', `/ouvrages/${a.id}/components`)
      .send({ kind: 'sub_ouvrage', childOuvrageId: b.id, quantity: '1' })
      .expect(201);
    // B contains A -> cycle -> rejected, nothing persisted
    await as('post', `/ouvrages/${b.id}/components`)
      .send({ kind: 'sub_ouvrage', childOuvrageId: a.id, quantity: '1' })
      .expect(400);
  });
});
