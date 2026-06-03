import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

interface Famille {
  id: string;
  code: string;
  metrics: Record<string, string>;
}
interface Lot {
  id: string;
  code: string;
  familles: Famille[];
}
interface Nature {
  nature: string;
  metrics: Record<string, string>;
  unallocated: Record<string, string>;
  lots: Lot[];
}

describe('Tableau de bord analytique B.0e — double axe (§5.8)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let familleId: string;

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
    ({ tenantId, userId } = await entitleUser(app, ds, 'AnaRes', 'admin', [
      'estimating',
      'site_tracking',
      'invoicing',
      'financial_management',
    ]));

    // analytical famille (material)
    const tree = (await as('get', '/analytical/plan').expect(200)).body;
    const material = tree.find((n: { nature: string }) => n.nature === 'material');
    familleId = material.lots[0].familles[0].id;

    // estimating: resource classified to that famille, used by an ouvrage
    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mat = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'MAT', label: 'Colle', unit: 'kg', nature: 'material', unitCost: '100', familleAnalytiqueId: familleId })
        .expect(201)
    ).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);

    const created = (await as('post', '/affaires').send({ code: 'AR-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/affaires/${created.affaire.id}/transition`).send({ to }).expect(201);
    }
    chantierId = (await as('post', `/affaires/${created.affaire.id}/accept`).expect(201)).body.chantier.id;

    // engagé + réalisé imputés à la même famille
    const ddp = (await as('post', `/chantiers/${chantierId}/purchase-requests`).send({ code: 'DDP' }).expect(201)).body;
    const order = (await as('post', `/purchase-requests/${ddp.id}/convert`).send({ code: 'BC' }).expect(201)).body;
    await as('post', `/purchase-orders/${order.id}/lines`)
      .send({ nature: 'material', designation: 'Colle', quantity: '10', unitPrice: '95', familleAnalytiqueId: familleId })
      .expect(201);
    await as('post', `/purchase-orders/${order.id}/validate`).expect(201);
    await as('post', `/purchase-orders/${order.id}/delivery-notes`).send({ code: 'BL' }).expect(201);
    await as('post', `/purchase-orders/${order.id}/invoices`)
      .send({ code: 'F1', nature: 'material', amountHt: '900', familleAnalytiqueId: familleId })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('agrège budget/engagé/réalisé jusqu’à la famille et réconcilie les totaux', async () => {
    const res = (await as('get', `/chantiers/${chantierId}/analytical-results`).expect(200)).body;

    const material: Nature = res.natures.find((n: Nature) => n.nature === 'material');
    const lot = material.lots.find((l: Lot) => l.familles.some((f) => f.id === familleId))!;
    const fam = lot.familles.find((f) => f.id === familleId)!;

    // budget objectif = 100 × 10 = 1000 ; engagé = 950 ; réalisé = 900 — tous à la famille
    expect(fam.metrics.budgetObjectif).toBe('1000');
    expect(fam.metrics.engage).toBe('950');
    expect(fam.metrics.realise).toBe('900');

    // remontée nature = famille (un seul flux)
    expect(material.metrics.budgetObjectif).toBe('1000');
    expect(material.metrics.engage).toBe('950');

    // total général réconcilié, pas de frais de chantier ici
    expect(res.total.budgetObjectif).toBe('1000');
    expect(res.total.engage).toBe('950');
    expect(res.total.realise).toBe('900');
    expect(res.siteOverhead.metrics.budgetObjectif).toBe('0');
    expect(res.siteOverhead.metrics.engage).toBe('0');
  });

  it('place un engagé non imputé dans le seau « Non réparti » de sa nature', async () => {
    const ddp = (await as('post', `/chantiers/${chantierId}/purchase-requests`).send({ code: 'DDP2' }).expect(201)).body;
    const order = (await as('post', `/purchase-requests/${ddp.id}/convert`).send({ code: 'BC2' }).expect(201)).body;
    // pas de familleAnalytiqueId → non réparti sous 'material'
    await as('post', `/purchase-orders/${order.id}/lines`)
      .send({ nature: 'material', designation: 'X', quantity: '1', unitPrice: '200' })
      .expect(201);
    await as('post', `/purchase-orders/${order.id}/validate`).expect(201);

    const res = (await as('get', `/chantiers/${chantierId}/analytical-results`).expect(200)).body;
    const material: Nature = res.natures.find((n: Nature) => n.nature === 'material');
    expect(material.unallocated.engage).toBe('200');
    // engagé total nature = famille (950) + non réparti (200)
    expect(material.metrics.engage).toBe('1150');
  });

  it('range les frais de chantier (site_overhead) dans la branche dédiée', async () => {
    const ddp = (await as('post', `/chantiers/${chantierId}/purchase-requests`).send({ code: 'DDP3' }).expect(201)).body;
    const order = (await as('post', `/purchase-requests/${ddp.id}/convert`).send({ code: 'BC3' }).expect(201)).body;
    await as('post', `/purchase-orders/${order.id}/lines`)
      .send({ nature: 'site_overhead', designation: 'Installation', quantity: '1', unitPrice: '500' })
      .expect(201);
    await as('post', `/purchase-orders/${order.id}/validate`).expect(201);

    const res = (await as('get', `/chantiers/${chantierId}/analytical-results`).expect(200)).body;
    expect(res.siteOverhead.metrics.engage).toBe('500');
    // total réconcilié = 4 natures (1150) + frais de chantier (500)
    expect(res.total.engage).toBe('1650');
  });
});
