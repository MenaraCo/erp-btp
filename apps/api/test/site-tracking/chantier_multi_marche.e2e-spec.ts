import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/** Chantier 1→N Marché (cahier des charges §5.4/5.5): two won affaires accepted onto the SAME
 *  chantier; costs aggregate at the chantier, each marché stays distinct. */
describe('Chantier 1→N Marché — agrégation de plusieurs marchés (refactor b.2)', () => {
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

  /** Builds a won affaire whose single ouvrage costs `unitCost` × qty 10, returns affaireId. */
  async function wonAffaire(code: string, unitCost: string): Promise<string> {
    const lib = (await as('post', '/libraries').send({ code: `L-${code}`, name: 'L' }).expect(201)).body;
    const res = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: `R-${code}`, label: 'R', unit: 'u', nature: 'material', unitCost }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: `O-${code}`, label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: res.id, quantity: '1' }).expect(201);
    const created = (await as('post', '/affaires').send({ code, name: code }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' }).expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' }).expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    return created.devis.id;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Multi', 'admin', ['estimating', 'site_tracking', 'invoicing']));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('rattache un second marché à un chantier existant et agrège les budgets', async () => {
    const a1 = await wonAffaire('LOT-PEINTURE', '100'); // budget 1000
    const a2 = await wonAffaire('LOT-SOLS', '150'); // budget 1500

    const t1 = (await as('post', `/devis/${a1}/accept`).expect(201)).body;
    const chantierId = t1.chantier.id;
    expect(t1.marche.chantier_id).toBe(chantierId);

    // second marché attaché au MÊME chantier
    const t2 = (await as('post', `/devis/${a2}/accept`).send({ chantierId }).expect(201)).body;
    expect(t2.chantier.id).toBe(chantierId);
    expect(t2.marche.chantier_id).toBe(chantierId);
    expect(t2.marche.id).not.toBe(t1.marche.id);

    // les coûts s'agrègent au chantier (budget objectif = 1000 + 1500)
    const results = (await as('get', `/chantiers/${chantierId}/results`).expect(200)).body;
    expect(results.totals.budgetObjectif).toBe('2500.00');
    expect(results.budgetVenteHt).toBe('2500.00');
  });

  it('refuse une double acceptation de la même affaire (409)', async () => {
    const a = await wonAffaire('LOT-DUP', '100');
    await as('post', `/devis/${a}/accept`).expect(201);
    await as('post', `/devis/${a}/accept`).expect(409);
  });
});
