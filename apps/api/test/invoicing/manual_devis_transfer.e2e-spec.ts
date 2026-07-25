import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Correctness (cahier §5.5) — régression signalée : un devis construit ENTIÈREMENT À LA MAIN dans le
 * montage (ouvrage manuel + ressources manuelles sans lien bibliothèque + ressource autonome) doit :
 *  - remonter ses ressources dans « calculer appro » ;
 *  - être transféré au chantier avec budget objectif = déboursé, ventilé par nature (MO/ST/matériaux) ;
 *  - produire un marché facturable (ouvrage + ressource autonome).
 * L'ancienne version ne matérialisait que le contenu issu de la bibliothèque → rien n'était exporté.
 */
describe('Invoicing — devis 100% manuel : appro + transfert chantier', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

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
    ({ tenantId, userId } = await entitleUser(app, ds, 'Mn', 'admin', ['estimating', 'site_tracking', 'invoicing']));
  });
  afterAll(async () => { await app.close(); await ds.destroy(); });

  it('ouvrage manuel + ressources manuelles + ressource autonome : appro, budget par nature, marché', async () => {
    const created = (await as('post', '/affaires').send({ code: 'MAN-1', name: 'Manuel' }).expect(201)).body;
    const vId = created.version.id;
    const titre = (await as('post', `/versions/${vId}/lines`).send({ type: 'titre', code: '1', designation: 'Lot' }).expect(201)).body;

    // Ouvrage MANUEL (aucun ouvrageId) : PEINTURE MUR, qté 10 m².
    const ouv = (await as('post', `/versions/${vId}/lines`)
      .send({ type: 'ouvrage', designation: 'Peinture mur', code: 'PM', unit: 'M2', quantity: '10', parentLineId: titre.id }).expect(201)).body;
    // Sous-détail MANUEL (source_resource_id NULL) : MO 0.5×30 = 15/u → 150 labor ; ST 1×20 = 20/u → 200 subcontract.
    const mo = (await as('post', `/versions/${vId}/lines`)
      .send({ type: 'ressource', designation: 'Application', code: 'MO', unit: 'H', quantity: '0.5', pu: '30', parentLineId: ouv.id }).expect(201)).body;
    await as('patch', `/lines/${mo.id}`).send({ nature: 'labor' }).expect(200);
    const st = (await as('post', `/versions/${vId}/lines`)
      .send({ type: 'ressource', designation: 'Sous-traitance pose', code: 'ST', unit: 'M2', quantity: '1', pu: '20', parentLineId: ouv.id }).expect(201)).body;
    await as('patch', `/lines/${st.id}`).send({ nature: 'subcontract' }).expect(200);

    // Ressource AUTONOME manuelle sous le titre : Enduit 25 × 12 × (1+4%) = 312 material.
    const enduit = (await as('post', `/versions/${vId}/lines`)
      .send({ type: 'ressource', designation: 'Enduit', code: 'END', unit: 'KG', quantity: '25', pu: '12', parentLineId: titre.id }).expect(201)).body;
    await as('patch', `/lines/${enduit.id}`).send({ perte: '4', nature: 'material' }).expect(200);

    // « Calculer appro » remonte bien les 3 ressources manuelles (régression : renvoyait vide).
    const appro = (await as('get', `/versions/${vId}/appro`).expect(200)).body;
    const approRows = appro.lines ?? appro.items ?? appro;
    expect(Array.isArray(approRows)).toBe(true);
    expect(approRows.length).toBeGreaterThanOrEqual(3);

    // Coeffs à 0 → PV = déboursé.
    await as('put', `/versions/${vId}/sale-sheet`).send({
      byNature: { labor: { tauxFg: '0', tauxBenefice: '0' }, material: { tauxFg: '0', tauxBenefice: '0' },
        equipment: { tauxFg: '0', tauxBenefice: '0' }, subcontract: { tauxFg: '0', tauxBenefice: '0' } }, tvaRate: '0.20',
    }).expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;

    // Budget objectif = déboursé (150 + 200 + 312 = 662) et ventilé par nature.
    const results = (await as('get', `/chantiers/${acc.chantier.id}/results`).expect(200)).body;
    expect(Number(results.totals.budgetObjectif)).toBeCloseTo(662, 2);
    expect(Number(results.budgetVenteHt)).toBeCloseTo(662, 2);
    const byNat = (n: string) => results.byNature.find((x: { nature: string }) => x.nature === n);
    expect(Number(byNat('labor').budgetObjectif)).toBeCloseTo(150, 2);
    expect(Number(byNat('subcontract').budgetObjectif)).toBeCloseTo(200, 2);
    expect(Number(byNat('material').budgetObjectif)).toBeCloseTo(312, 2);

    // Marché facturable : ouvrage manuel + ressource autonome = 2 lignes, total 662.
    const marche = (await as('get', `/marches/${acc.marche.id}`).expect(200)).body;
    const ouvrages = marche.lines.filter((l: { type: string }) => l.type === 'ouvrage');
    expect(ouvrages.length).toBe(2);
    expect(Number(marche.marche.total_ht)).toBeCloseTo(662, 2);
  });
});
