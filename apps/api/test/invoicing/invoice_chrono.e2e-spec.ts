import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Invoicing 2.5 — sociétés, chrono figé et factures', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let marcheId: string;
  let companyId: string;

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

  async function newSituation(pct: string) {
    const lineId = (await as('get', `/marches/${marcheId}`).expect(200)).body.lines[0].id;
    return (
      await as('post', `/marches/${marcheId}/situations`)
        .send({ lines: [{ marcheLineId: lineId, pctAvancement: pct }] })
        .expect(201)
    ).body;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Inv', 'admin', ['estimating', 'invoicing']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mat = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'M', label: 'M', unit: 'u', nature: 'material', unitCost: '100' })
        .expect(201)
    ).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'INV-A', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/affaires/${created.affaire.id}/transition`).send({ to }).expect(201);
    }
    marcheId = (await as('post', `/affaires/${created.affaire.id}/transfer`).expect(201)).body.marche.id;

    companyId = (await as('post', '/companies').send({ code: 'STE1', name: 'Société 1' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('exige un chrono configuré avant de facturer', async () => {
    const s = await newSituation('0.3');
    await as('post', `/situations/${s.id}/invoice`).send({ companyId }).expect(400);
  });

  it('numérote la 1ère facture puis fige le chrono', async () => {
    await as('put', `/companies/${companyId}/chrono`).send({ pattern: 'FAC-{YYYY}-{SEQ:5}' }).expect(200);

    const s1 = await newSituation('0.5'); // cumul 500, déjà 300 -> période 200, TVA 40
    const inv1 = (await as('post', `/situations/${s1.id}/invoice`).send({ companyId }).expect(201)).body;
    expect(inv1.numero).toBe('FAC-2026-00001');
    expect(inv1.montant_ht).toBe('200.00');
    expect(inv1.ttc).toBe('240.00');

    // chrono figé : reconfiguration refusée
    await as('put', `/companies/${companyId}/chrono`).send({ pattern: 'AUTRE-{SEQ}' }).expect(409);

    // 2e facture -> séquence incrémentée
    const s2 = await newSituation('1'); // cumul 1000, période 500
    const inv2 = (await as('post', `/situations/${s2.id}/invoice`).send({ companyId }).expect(201)).body;
    expect(inv2.numero).toBe('FAC-2026-00002');

    // double facturation d'une situation -> refus
    await as('post', `/situations/${s2.id}/invoice`).send({ companyId }).expect(409);
  });
});
