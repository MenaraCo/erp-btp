import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Invoicing 2.4 — DGD (décompte général définitif)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let marcheId: string;

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
    ({ tenantId, userId } = await entitleUser(app, ds, 'Dgd', 'admin', ['estimating', 'invoicing']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mat = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'M', label: 'M', unit: 'u', nature: 'material', unitCost: '100' })
        .expect(201)
    ).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'DGD-A', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '16' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    marcheId = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body.marche.id;
    // marché = 16 * 100 = 1600 HT
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('exige au moins une situation avant de générer le DGD', async () => {
    await as('post', `/marches/${marcheId}/dgd`).expect(400);
  });

  it('génère le DGD à partir de la dernière situation (100%)', async () => {
    const lineId = (await as('get', `/marches/${marcheId}`).expect(200)).body.lines[0].id;
    // situation à 100% : cumul 1600, TVA 320, TTC 1920, retenue 80, NAP 1840
    await as('post', `/marches/${marcheId}/situations`)
      .send({ lines: [{ marcheLineId: lineId, pctAvancement: '1' }] })
      .expect(201);

    const dgd = (await as('post', `/marches/${marcheId}/dgd`).expect(201)).body;
    expect(dgd.travaux_cumul_ht).toBe('1600.00');
    expect(dgd.tva).toBe('320.00');
    expect(dgd.ttc).toBe('1920.00');
    expect(dgd.retenue_garantie_totale).toBe('80.00');
    expect(dgd.deja_regle_nap).toBe('1840.00');
    expect(dgd.solde_nap).toBe('80.00'); // retenue de garantie à libérer

    const fetched = (await as('get', `/marches/${marcheId}/dgd`).expect(200)).body;
    expect(fetched.solde_nap).toBe('80.00');
  });
});
