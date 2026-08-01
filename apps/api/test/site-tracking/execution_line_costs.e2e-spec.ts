import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Axe structurel du pilotage (cahier §5.8) : engagé (commande validée) et réalisé (facture
 * fournisseur + pointage) imputés à un OUVRAGE remontent par ouvrage dans l'arbre d'exécution.
 */
describe('Site-tracking — engagé/réalisé par ouvrage', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let marcheId: string;
  let lineId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path)
      : method === 'put' ? request(server).put(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }
  const findLine = (tree: { marches: Array<{ lines: Array<{ id: string; engage: string; realise: string }> }> }, id: string) =>
    tree.marches.flatMap((m) => m.lines).find((l) => l.id === id)!;

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Co', 'admin', ['estimating', 'site_tracking', 'invoicing']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '40' }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'CO-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Ouvrage', sourceOuvrageId: ouv.id, quantity: '10' }).expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' }).expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    chantierId = acc.chantier.id; marcheId = acc.marche.id;
    await as('post', `/marches/${marcheId}/etude/validate`).expect(201);
    await as('post', `/marches/${marcheId}/contre-etude/validate`).expect(201);
    lineId = (await as('get', `/chantiers/${chantierId}`)).body.lines[0].id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('sans imputation, engagé/réalisé de l’ouvrage restent à 0', async () => {
    const tree = (await as('get', `/chantiers/${chantierId}/execution-tree`).expect(200)).body;
    const line = findLine(tree, lineId);
    expect(Number(line.engage)).toBe(0);
    expect(Number(line.realise)).toBe(0);
  });

  it('agrège engagé (BC validé) et réalisé (facture + pointage) sur l’ouvrage', async () => {
    // Commande validée imputée à l'ouvrage → engagé 500
    const order = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({ code: 'BC1' }).expect(201)).body;
    await as('post', `/purchase-orders/${order.id}/lines`)
      .send({ executionLineId: lineId, nature: 'material', designation: 'Béton', quantity: '5', unitPrice: '100' }).expect(201);
    await as('post', `/purchase-orders/${order.id}/validate`).expect(201);
    // Facture fournisseur imputée → réalisé achats 300
    await as('post', `/purchase-orders/${order.id}/invoices`)
      .send({ executionLineId: lineId, code: 'F1', nature: 'material', amountHt: '300' }).expect(201);
    // Pointage imputé → réalisé MO 420 (10h × 42)
    await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ executionLineId: lineId, employee: 'Equipe', date: '2026-06-02', hours: '10', hourlyCost: '42' }).expect(201);

    const tree = (await as('get', `/chantiers/${chantierId}/execution-tree`).expect(200)).body;
    const line = findLine(tree, lineId);
    expect(Number(line.engage)).toBe(500);
    expect(Number(line.realise)).toBe(720); // 300 facture + 420 pointage
  });

  it('rejette une imputation vers un ouvrage d’un autre chantier (404)', async () => {
    const order = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({ code: 'BC2' }).expect(201)).body;
    await as('post', `/purchase-orders/${order.id}/lines`)
      .send({ executionLineId: '00000000-0000-0000-0000-000000000000', nature: 'material', designation: 'X', quantity: '1', unitPrice: '1' })
      .expect(404);
  });
});
