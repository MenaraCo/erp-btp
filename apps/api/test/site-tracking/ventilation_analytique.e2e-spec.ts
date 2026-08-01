import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Une ressource chiffrée sans code analytique ne doit jamais être rangée d'office dans une nature :
 * elle atterrit dans la branche « 999 — À ventiler », visible tant qu'elle y reste, et le
 * conducteur la ventile depuis le suivi de chantier.
 */
describe('Suivi de chantier — ventilation analytique (999 À ventiler)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get' ? request(server).get(path)
        : method === 'put' ? request(server).put(path)
          : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  /** Devis à une ressource autonome NON classée (aucun code analytique). */
  async function acceptDevisSansCode(code: string) {
    const created = (await as('post', '/affaires').send({ code, name: code }).expect(201)).body;
    const vId = created.version.id;
    const titre = (
      await as('post', `/versions/${vId}/lines`)
        .send({ type: 'titre', code: '1', designation: 'T', sortOrder: 1 })
        .expect(201)
    ).body;
    await as('post', `/versions/${vId}/lines`)
      .send({
        type: 'ressource', parentLineId: titre.id, code: 'SANSCODE', designation: 'Prestation non classée',
        unit: 'u', quantity: '10', pu: '100', nature: 'labor',
      })
      .expect(201);
    await as('put', `/versions/${vId}/sale-sheet`)
      .send({
        byNature: {
          labor: { tauxFg: '0', tauxBenefice: '0' },
          material: { tauxFg: '0', tauxBenefice: '0' },
          equipment: { tauxFg: '0', tauxBenefice: '0' },
          subcontract: { tauxFg: '0', tauxBenefice: '0' },
        },
        tvaRate: '0.20',
      })
      .expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    return (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Ventil', 'admin', [
      'estimating',
      'site_tracking',
      'invoicing',
      'financial_management',
    ]));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('range une ressource sans code dans « À ventiler », hors des natures', async () => {
    const acc = await acceptDevisSansCode('VEN-1');
    const res = (
      await as('get', `/chantiers/${acc.chantier.id}/analytical-results`).expect(200)
    ).body;

    expect(res.aVentiler.code).toBe('999');
    expect(res.aVentiler.label).toBe('À ventiler');
    expect(Number(res.aVentiler.metrics.budgetObjectif)).toBe(1000); // 10 × 100
    // Aucune nature ne s'est approprié le montant.
    for (const n of res.natures) {
      expect(Number(n.metrics.budgetObjectif)).toBe(0);
    }
    // Le total reste juste.
    expect(Number(res.total.budgetObjectif)).toBe(1000);
    // La ressource est proposée à la ventilation, avec de quoi la reconnaître.
    expect(res.aVentiler.resources).toHaveLength(1);
    expect(res.aVentiler.resources[0].label).toBe('Prestation non classée');
    expect(res.aVentiler.resources[0].nature).toBe('labor');
  });

  it('ventile la ressource sur un code analytique : elle quitte 999 pour sa nature', async () => {
    const acc = await acceptDevisSansCode('VEN-2');
    const before = (
      await as('get', `/chantiers/${acc.chantier.id}/analytical-results`).expect(200)
    ).body;
    const resourceId = before.aVentiler.resources[0].id;

    // Un code du plan société (créé pour le test sous un lot/famille de main-d'œuvre).
    const plan = (await as('get', '/analytical/plan').expect(200)).body;
    const labor = plan.find((n: { nature: string }) => n.nature === 'labor');
    const famille = labor.lots[0].familles[0];
    const code = (
      await as('post', '/analytical/codes')
        .send({ familleId: famille.id, code: 'VEN-500', label: 'MO ventilée' })
        .expect(201)
    ).body;

    await as('put', `/chantiers/${acc.chantier.id}/nomenclature/${resourceId}/code-analytique`)
      .send({ codeAnalytiqueId: code.id })
      .expect(200);

    const after = (
      await as('get', `/chantiers/${acc.chantier.id}/analytical-results`).expect(200)
    ).body;
    expect(Number(after.aVentiler.metrics.budgetObjectif)).toBe(0);
    expect(after.aVentiler.resources).toHaveLength(0);
    const laborAfter = after.natures.find((n: { nature: string }) => n.nature === 'labor');
    expect(Number(laborAfter.metrics.budgetObjectif)).toBe(1000);
    expect(Number(after.total.budgetObjectif)).toBe(1000);
  });

  it('refuse (404) un code analytique inconnu', async () => {
    const acc = await acceptDevisSansCode('VEN-3');
    const res = (
      await as('get', `/chantiers/${acc.chantier.id}/analytical-results`).expect(200)
    ).body;
    await as('put', `/chantiers/${acc.chantier.id}/nomenclature/${res.aVentiler.resources[0].id}/code-analytique`)
      .send({ codeAnalytiqueId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);
  });
});
