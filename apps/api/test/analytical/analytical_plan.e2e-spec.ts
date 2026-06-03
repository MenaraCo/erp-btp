import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Plan analytique B.0a — nature → lot → famille (§5.8)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post', path: string, tId = tenantId, uId = userId) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tId).set('X-User-Id', uId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Plan', 'admin', ['estimating']));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('duplique le plan modèle à la première lecture (les 4 natures, arbre dépliable)', async () => {
    const tree = (await as('get', '/analytical/plan').expect(200)).body;
    expect(tree.map((n: { nature: string }) => n.nature)).toEqual([
      'material',
      'equipment',
      'subcontract',
      'labor',
    ]);
    const material = tree.find((n: { nature: string }) => n.nature === 'material');
    expect(material.label).toBe('Matériaux');
    expect(material.lots.length).toBeGreaterThan(0);
    const sols = material.lots.find((l: { code: string }) => l.code === 'MAT-SOL');
    expect(sols.familles.map((f: { code: string }) => f.code)).toContain('MAT-SOL-COL');
  });

  it('est idempotent : une seconde lecture ne re-duplique pas le plan', async () => {
    const before = (await as('get', '/analytical/plan').expect(200)).body;
    const after = (await as('get', '/analytical/plan').expect(200)).body;
    const count = (tree: { lots: unknown[] }[]) =>
      tree.reduce((sum, n) => sum + n.lots.length, 0);
    expect(count(after)).toBe(count(before));
  });

  it('ajoute un lot et une famille sous une nature', async () => {
    const lot = (
      await as('post', '/analytical/lots')
        .send({ nature: 'material', code: 'MAT-PEI', label: 'Peintures' })
        .expect(201)
    ).body;
    expect(lot.id).toBeDefined();

    const fam = (
      await as('post', '/analytical/familles')
        .send({ lotId: lot.id, code: 'MAT-PEI-ACR', label: 'Acryliques' })
        .expect(201)
    ).body;
    expect(fam.lot_id).toBe(lot.id);

    const tree = (await as('get', '/analytical/plan').expect(200)).body;
    const material = tree.find((n: { nature: string }) => n.nature === 'material');
    const peintures = material.lots.find((l: { code: string }) => l.code === 'MAT-PEI');
    expect(peintures.familles.map((f: { code: string }) => f.code)).toContain('MAT-PEI-ACR');
  });

  it('refuse un code analytique déjà utilisé (409)', async () => {
    await as('post', '/analytical/lots')
      .send({ nature: 'material', code: 'MAT-SOL', label: 'Doublon' })
      .expect(409);
  });

  it('refuse une nature inconnue (400)', async () => {
    await as('post', '/analytical/lots')
      .send({ nature: 'bogus', code: 'X-1', label: 'X' })
      .expect(400);
  });

  it('refuse l’accès sans le module Études de prix (403)', async () => {
    const other = await entitleUser(app, ds, 'NoEstim', 'admin', ['core']);
    await as('get', '/analytical/plan', other.tenantId, other.userId).expect(403);
  });
});
