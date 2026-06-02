import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Estimating 1.4 — feuille de vente (déboursé -> PV, ventilation, TVA)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let libraryId: string;
  let ouvrageId: string;

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
    ({ tenantId, userId } = await entitleUser(app, ds, 'Vente', 'admin', 'estimating'));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'Lib' }).expect(201)).body;
    libraryId = lib.id;
    const mo = (
      await as('post', `/libraries/${libraryId}/resources`)
        .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '100' })
        .expect(201)
    ).body;
    const mat = (
      await as('post', `/libraries/${libraryId}/resources`)
        .send({ code: 'MAT', label: 'Matériau', unit: 'u', nature: 'material', unitCost: '200' })
        .expect(201)
    ).body;
    // OUV1 = 100 labor + 200 material -> déboursé 300
    const ouv = (
      await as('post', `/libraries/${libraryId}/ouvrages`)
        .send({ code: 'OUV1', label: 'Ouvrage 1', unit: 'u' })
        .expect(201)
    ).body;
    ouvrageId = ouv.id;
    await as('post', `/ouvrages/${ouvrageId}/components`)
      .send({ kind: 'resource', childResourceId: mo.id, quantity: '1' })
      .expect(201);
    await as('post', `/ouvrages/${ouvrageId}/components`)
      .send({ kind: 'resource', childResourceId: mat.id, quantity: '1' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('applique les coefficients par nature (rule #2) avec TVA', async () => {
    const version = (
      await as('post', '/affaires').send({ code: 'AV1', name: 'A' }).expect(201)
    ).body.version;
    await as('post', `/versions/${version.id}/lines`)
      .send({ type: 'ouvrage', designation: 'Ligne 1', sourceOuvrageId: ouvrageId, quantity: '1' })
      .expect(201);
    await as('put', `/versions/${version.id}/sale-sheet`)
      .send({
        byNature: { labor: '1.5', material: '1.2', equipment: '1', subcontract: '1' },
        fraisCoefficient: '1',
        tvaRate: '0.20',
      })
      .expect(200);

    const fv = (await as('get', `/versions/${version.id}/sale-sheet`).expect(200)).body;
    // 100*1.5 + 200*1.2 = 390 ; TVA 20% = 78 ; TTC 468
    expect(fv.totalPvHt).toBe('390');
    expect(fv.tva).toBe('78');
    expect(fv.totalTtc).toBe('468');
    expect(fv.items[0].appliedCoefficients.labor).toBe('1.5');
  });

  it('ventile les frais de chantier (rule #3) prorata déboursé', async () => {
    const version = (
      await as('post', '/affaires').send({ code: 'AV2', name: 'B' }).expect(201)
    ).body.version;
    // 2 vendable lines (déboursé 300 each) + 1 non-vendable frais (déboursé 300)
    await as('post', `/versions/${version.id}/lines`)
      .send({ type: 'ouvrage', designation: 'V1', sourceOuvrageId: ouvrageId, quantity: '1' })
      .expect(201);
    await as('post', `/versions/${version.id}/lines`)
      .send({ type: 'ouvrage', designation: 'V2', sourceOuvrageId: ouvrageId, quantity: '1' })
      .expect(201);
    await as('post', `/versions/${version.id}/lines`)
      .send({
        type: 'ouvrage',
        designation: 'Frais chantier',
        sourceOuvrageId: ouvrageId,
        quantity: '1',
        vendable: false,
      })
      .expect(201);
    // coefficients all 1 -> PV = déboursé + ventilated frais. Frais 300 split 150/150.
    await as('put', `/versions/${version.id}/sale-sheet`)
      .send({
        byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' },
        fraisCoefficient: '1',
        tvaRate: '0',
      })
      .expect(200);

    const fv = (await as('get', `/versions/${version.id}/sale-sheet`).expect(200)).body;
    expect(fv.items).toHaveLength(2); // only vendable items are priced
    for (const item of fv.items) {
      expect(item.ventilatedFrais).toBe('150'); // 300 * 300/600
      expect(item.pv).toBe('450'); // 300 + 150
    }
    expect(fv.totalPvHt).toBe('900'); // total conserved: 300+300+300
  });
});
