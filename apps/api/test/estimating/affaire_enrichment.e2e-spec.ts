import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * M.2 — l'affaire porte le lieu d'exécution structuré, le budget objectif, le responsable ;
 * GET /affaires/:id renvoie les KPI agrégés (déboursé, revient, PV, marges) par devis + totaux.
 */
describe('Estimating — enrichissement affaire (lieu structuré, métadonnées, KPI agrégés)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let ouvrageId: string;

  function as(method: 'get' | 'post' | 'put' | 'patch', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get' ? request(server).get(path)
        : method === 'put' ? request(server).put(path)
          : method === 'patch' ? request(server).patch(path)
            : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Enrich', 'admin', 'estimating'));
    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const r = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'R', label: 'R', unit: 'u', nature: 'material', unitCost: '100' }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: r.id, quantity: '1' }).expect(201);
    ouvrageId = ouv.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('met à jour le lieu d’exécution structuré + métadonnées', async () => {
    const created = (await as('post', '/affaires').send({ code: 'EN-1', name: 'Villa' }).expect(201)).body;
    const lieu = { adresse: '12 rue des Lilas', code_postal: '75011', ville: 'Paris', pays: 'FR' };
    await as('patch', `/affaires/${created.affaire.id}`)
      .send({ lieuExecution: lieu, budgetObjectif: '50000', responsable: 'A. Martin', notes: 'Chantier prioritaire' })
      .expect(200);

    const detail = (await as('get', `/affaires/${created.affaire.id}`).expect(200)).body;
    expect(detail.affaire.lieu_execution).toEqual(lieu);
    expect(detail.affaire.responsable).toBe('A. Martin');
    expect(Number(detail.affaire.budget_objectif)).toBe(50000);
    expect(detail.affaire.notes).toBe('Chantier prioritaire');
  });

  it('agrège les KPI par devis + totaux affaire', async () => {
    const created = (await as('post', '/affaires').send({ code: 'EN-2', name: 'B' }).expect(201)).body;
    // devis principal : 1 ouvrage (déboursé 100) × qty 5 = 500, marge via FG 20 %
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouvrageId, quantity: '5' }).expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({
        byNature: {
          labor: { tauxFg: '0', tauxBenefice: '0' },
          material: { tauxFg: '20', tauxBenefice: '10' },
          equipment: { tauxFg: '0', tauxBenefice: '0' },
          subcontract: { tauxFg: '0', tauxBenefice: '0' },
        },
        tvaRate: '0.20',
      }).expect(200);

    const detail = (await as('get', `/affaires/${created.affaire.id}`).expect(200)).body;
    const kpis = detail.devis[0].kpis;
    // déboursé 500 → revient 600 (×1.2) → PV 660 (×1.1)
    expect(kpis.debourse).toBe('500');
    expect(kpis.revient).toBe('600');
    expect(kpis.pvHt).toBe('660');
    expect(kpis.margeBrute).toBe('160'); // 660 − 500
    expect(kpis.margeNette).toBe('60'); // 660 − 600
    expect(Number(detail.totals.pvHt)).toBe(660);
    expect(Number(detail.totals.margeNette)).toBe(60);
  });
});
