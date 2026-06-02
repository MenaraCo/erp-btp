import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Compliance 2.6 — Factur-X, CII XML, e-facture (Chorus Pro stub)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let invoiceId: string;

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
    ({ tenantId, userId } = await entitleUser(app, ds, 'Fx', 'admin', ['core', 'estimating', 'invoicing']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mat = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'M', label: 'M', unit: 'u', nature: 'material', unitCost: '100' })
        .expect(201)
    ).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'FX-A', name: 'Chantier Dupont' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/affaires/${created.affaire.id}/transition`).send({ to }).expect(201);
    }
    const marcheId = (await as('post', `/affaires/${created.affaire.id}/transfer`).expect(201)).body.marche.id;
    const lineId = (await as('get', `/marches/${marcheId}`).expect(200)).body.lines[0].id;
    const situation = (
      await as('post', `/marches/${marcheId}/situations`)
        .send({ lines: [{ marcheLineId: lineId, pctAvancement: '1' }] })
        .expect(201)
    ).body;
    const companyId = (
      await as('post', '/companies').send({ code: 'STE', name: 'Entreprise Démo BTP', vatNumber: 'FR12345678901' }).expect(201)
    ).body.id;
    await as('put', `/companies/${companyId}/chrono`).send({ pattern: 'FAC-{YYYY}-{SEQ:5}' }).expect(200);
    invoiceId = (await as('post', `/situations/${situation.id}/invoice`).send({ companyId }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('génère le XML CII (Factur-X)', async () => {
    const res = await as('get', `/invoices/${invoiceId}/cii.xml`).expect(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.text).toContain('<rsm:CrossIndustryInvoice');
    expect(res.text).toContain('FAC-2026-00001');
    expect(res.text).toContain('<ram:GrandTotalAmount>1200.00</ram:GrandTotalAmount>'); // 1000 HT + 200 TVA
    expect(res.text).toContain('FR12345678901');
  });

  it('génère le PDF Factur-X (XML embarqué)', async () => {
    const res = await as('get', `/invoices/${invoiceId}/factur-x.pdf`)
      .buffer(true)
      .parse((response, cb) => {
        const data: Buffer[] = [];
        response.on('data', (c: Buffer) => data.push(Buffer.from(c)));
        response.on('end', () => cb(null, Buffer.concat(data)));
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect((res.body as Buffer).subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('cycle de vie : issued -> submit (Chorus Pro) -> accepted -> paid', async () => {
    const initial = (await as('get', `/invoices/${invoiceId}/einvoice`).expect(200)).body;
    expect(initial.status).toBe('issued');

    const submitted = (await as('post', `/invoices/${invoiceId}/einvoice/submit`).expect(201)).body;
    expect(submitted.status).toBe('submitted');
    expect(submitted.chorus_pro_ref).toMatch(/^CPRO-/);

    // transition invalide submitted -> paid
    await as('post', `/invoices/${invoiceId}/einvoice/transition`).send({ to: 'paid' }).expect(409);

    await as('post', `/invoices/${invoiceId}/einvoice/transition`).send({ to: 'accepted' }).expect(201);
    const paid = (await as('post', `/invoices/${invoiceId}/einvoice/transition`).send({ to: 'paid' }).expect(201)).body;
    expect(paid.status).toBe('paid');
  });
});
