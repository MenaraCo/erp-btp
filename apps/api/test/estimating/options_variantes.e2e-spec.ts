import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * M.3 — un titre marqué option/variante (propagé à ses lignes) est valorisé mais EXCLU du total
 * contractuel et du marché.
 */
describe('Estimating — options & variantes', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let ouvrageId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path)
      : method === 'put' ? request(server).put(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'OV', 'admin', ['estimating', 'invoicing']));
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

  it('exclut une option du total principal mais la valorise à part, et l’exclut du marché', async () => {
    const created = (await as('post', '/affaires').send({ code: 'OV-1', name: 'A' }).expect(201)).body;
    const vId = created.version.id;

    // Titre base + son ouvrage (déboursé 100 × 10 = 1000)
    const titreBase = (await as('post', `/versions/${vId}/lines`)
      .send({ type: 'titre', code: '1', designation: 'Base', sortOrder: 1 }).expect(201)).body;
    await as('post', `/versions/${vId}/lines`)
      .send({ type: 'ouvrage', parentLineId: titreBase.id, designation: 'L1', sourceOuvrageId: ouvrageId, quantity: '10', sortOrder: 1 }).expect(201);

    // Titre OPTION + son ouvrage (déboursé 100 × 5 = 500)
    const titreOpt = (await as('post', `/versions/${vId}/lines`)
      .send({ type: 'titre', code: '2', designation: 'Option chauffage', sortOrder: 2, sectionType: 'option' }).expect(201)).body;
    await as('post', `/versions/${vId}/lines`)
      .send({ type: 'ouvrage', parentLineId: titreOpt.id, designation: 'L2', sourceOuvrageId: ouvrageId, quantity: '5', sortOrder: 1 }).expect(201);

    await as('put', `/versions/${vId}/sale-sheet`)
      .send({
        byNature: {
          labor: { tauxFg: '0', tauxBenefice: '0' },
          material: { tauxFg: '0', tauxBenefice: '0' },
          equipment: { tauxFg: '0', tauxBenefice: '0' },
          subcontract: { tauxFg: '0', tauxBenefice: '0' },
        },
        tvaRate: '0',
      }).expect(200);

    const fv = (await as('get', `/versions/${vId}/sale-sheet`).expect(200)).body;
    expect(fv.totalPvHt).toBe('1000'); // base seule
    expect(fv.optionsPvHt).toBe('500'); // option à part
    const optItem = fv.items.find(
      (i: { id: string; debourse: string; section: string }) => Number(i.debourse) === 500,
    );
    expect(optItem.section).toBe('option');

    // Acceptation : le marché ne contient que la base (1 ligne), pas l'option
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    expect(acc.lineCount).toBe(1);
    expect(acc.marche.total_ht).toBe('1000.00');
  });

  it('toggle d’une section via PUT /lines/:id/section', async () => {
    const created = (await as('post', '/affaires').send({ code: 'OV-2', name: 'B' }).expect(201)).body;
    const vId = created.version.id;
    const titre = (await as('post', `/versions/${vId}/lines`)
      .send({ type: 'titre', code: '1', designation: 'T', sortOrder: 1 }).expect(201)).body;
    await as('post', `/versions/${vId}/lines`)
      .send({ type: 'ouvrage', parentLineId: titre.id, designation: 'L', sourceOuvrageId: ouvrageId, quantity: '2', sortOrder: 1 }).expect(201);

    // normal : 200 dans le total
    let fv = (await as('get', `/versions/${vId}/sale-sheet`).expect(200)).body;
    expect(fv.totalPvHt).toBe('200');

    // marque le titre variante -> sort du total
    await as('put', `/lines/${titre.id}/section`).send({ sectionType: 'variante' }).expect(200);
    fv = (await as('get', `/versions/${vId}/sale-sheet`).expect(200)).body;
    expect(fv.totalPvHt).toBe('0');
    expect(fv.variantesPvHt).toBe('200');

    // re-normalise
    await as('put', `/lines/${titre.id}/section`).send({ sectionType: null }).expect(200);
    fv = (await as('get', `/versions/${vId}/sale-sheet`).expect(200)).body;
    expect(fv.totalPvHt).toBe('200');
  });
});
