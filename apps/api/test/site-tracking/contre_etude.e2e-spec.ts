import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Site-tracking 3.2 — contre-étude (renégociation PU / quantités, gel)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;

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

  const objLabor = (body: { budgetByNature: { nature: string; objectif: string }[] }) =>
    Object.fromEntries(body.budgetByNature.map((b) => [b.nature, b.objectif])).labor;
  const etuLabor = (body: { budgetByNature: { nature: string; etude: string }[] }) =>
    Object.fromEntries(body.budgetByNature.map((b) => [b.nature, b.etude])).labor;

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Ce', 'admin', ['estimating', 'site_tracking']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '40' })
        .expect(201)
    ).body;
    const mat = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'MAT', label: 'Béton', unit: 'm3', nature: 'material', unitCost: '100' })
        .expect(201)
    ).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'CE-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/affaires/${created.affaire.id}/transition`).send({ to }).expect(201);
    }
    chantierId = (await as('post', `/affaires/${created.affaire.id}/transfer-to-chantier`).expect(201)).body.chantier.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('renégocie un PU : budget objectif recalculé, budget étude figé', async () => {
    const nomenc = (await as('get', `/chantiers/${chantierId}/nomenclature`).expect(200)).body;
    const moRes = nomenc.find((n: { code: string }) => n.code === 'MO');
    expect(moRes.unit_cost_etude).toBe('40.0000');

    // MO 40 -> 50 : objectif labor = 2 * 50 * 10 = 1000 ; étude reste 800
    const res = (
      await as('put', `/chantiers/${chantierId}/nomenclature/${moRes.id}`)
        .send({ unitCostObjectif: '50' })
        .expect(200)
    ).body;
    expect(objLabor(res)).toBe('1000.00');
    expect(etuLabor(res)).toBe('800.00');
  });

  it('modifie une quantité : budget objectif recalculé', async () => {
    const comp = await runInTenant(ds, tenantId, (em) =>
      em.query(
        `SELECT ec.id FROM execution_component ec
           JOIN nomenclature_resource n ON n.id = ec.nomenclature_resource_id
          WHERE n.code = 'MO' AND ec.kind = 'resource' LIMIT 1`,
      ),
    );
    // MO quantité 2 -> 3, prix objectif 50 : objectif labor = 3 * 50 * 10 = 1500
    const res = (
      await as('put', `/execution-components/${comp[0].id}/quantity`)
        .send({ quantiteObjectif: '3' })
        .expect(200)
    ).body;
    expect(objLabor(res)).toBe('1500.00');
    expect(etuLabor(res)).toBe('800.00');
  });

  it('valide la contre-étude puis fige (409 sur nouvelle renégociation)', async () => {
    const validated = (await as('post', `/chantiers/${chantierId}/contre-etude/validate`).expect(201)).body;
    expect(validated.chantier.contre_etude_status).toBe('validated');

    const nomenc = (await as('get', `/chantiers/${chantierId}/nomenclature`).expect(200)).body;
    const moRes = nomenc.find((n: { code: string }) => n.code === 'MO');
    await as('put', `/chantiers/${chantierId}/nomenclature/${moRes.id}`)
      .send({ unitCostObjectif: '60' })
      .expect(409);
  });
});
