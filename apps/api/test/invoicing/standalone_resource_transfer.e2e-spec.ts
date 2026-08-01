import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Correctness (cahier §5.5) : une ressource AUTONOME du devis (posée sous un titre, hors ouvrage)
 * doit être transférée au chantier — budget objectif = déboursé — ET facturable (ligne de marché).
 * Régression : le transfert ne matérialisait que les ouvrages issus de la bibliothèque.
 */
describe('Invoicing — les ressources autonomes sont transférées (budget + facturation)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path)
      : method === 'put' ? request(server).put(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'St', 'admin', ['estimating', 'site_tracking', 'invoicing']));
  });
  afterAll(async () => { await app.close(); await ds.destroy(); });

  it('ouvrage + ressource autonome : budget objectif = déboursé et les 2 lignes sont facturables', async () => {
    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'MO', label: 'Maçon', unit: 'H', nature: 'labor', unitCost: '40' }).expect(201)).body;
    const beton = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'BET', label: 'Béton', unit: 'M3', nature: 'material', unitCost: '100' }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'U' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);

    const created = (await as('post', '/affaires').send({ code: 'ST-1', name: 'A' }).expect(201)).body;
    const vId = created.version.id;
    const titre = (await as('post', `/versions/${vId}/lines`).send({ type: 'titre', code: '1', designation: 'Lot' }).expect(201)).body;
    // ouvrage biblio (MO 2×40 × qty 10 = 800 labor)
    await as('post', `/versions/${vId}/ouvrages`).send({ ouvrageId: ouv.id, quantity: '10', parentLineId: titre.id }).expect(201);
    // ressource AUTONOME sous le titre : Béton 5 × 100 = 500 material
    await as('post', `/versions/${vId}/lines`)
      .send({ type: 'ressource', designation: 'Béton direct', code: 'BET', quantity: '5', pu: '100', nature: 'material', sourceResourceId: beton.id, parentLineId: titre.id }).expect(201);
    // coeffs à 0 → PV = déboursé
    await as('put', `/versions/${vId}/sale-sheet`).send({
      byNature: { labor: { tauxFg: '0', tauxBenefice: '0' }, material: { tauxFg: '0', tauxBenefice: '0' },
        equipment: { tauxFg: '0', tauxBenefice: '0' }, subcontract: { tauxFg: '0', tauxBenefice: '0' } }, tvaRate: '0.20',
    }).expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;

    // Budget objectif = déboursé total (800 labor + 500 material = 1300), = budget vente (coeffs 0).
    const results = (await as('get', `/chantiers/${acc.chantier.id}/results`).expect(200)).body;
    expect(Number(results.totals.budgetObjectif)).toBeCloseTo(1300, 2);
    expect(Number(results.budgetVenteHt)).toBeCloseTo(1300, 2);
    const labor = results.byNature.find((n: { nature: string }) => n.nature === 'labor');
    const material = results.byNature.find((n: { nature: string }) => n.nature === 'material');
    expect(Number(labor.budgetObjectif)).toBeCloseTo(800, 2);
    expect(Number(material.budgetObjectif)).toBeCloseTo(500, 2); // la ressource autonome

    // Facturation : le marché contient le titre + l'ouvrage + la ressource autonome (2 lignes facturables).
    const marche = (await as('get', `/marches/${acc.marche.id}`).expect(200)).body;
    const ouvrages = marche.lines.filter((l: { type: string }) => l.type === 'ouvrage');
    expect(ouvrages.length).toBe(2);
    const total = ouvrages.reduce((a: number, l: { montant_ht: string }) => a + Number(l.montant_ht), 0);
    expect(total).toBeCloseTo(1300, 2);
    expect(Number(marche.marche.total_ht)).toBeCloseTo(1300, 2);
  });
});
