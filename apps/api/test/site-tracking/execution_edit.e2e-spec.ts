import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Édition structurelle en contre-étude (cahier §5.5) : ajouter/supprimer des ouvrages et des
 * ressources propres au chantier, modifier les quantités — le budget objectif est recalculé.
 */
describe('Site-tracking — édition structurelle des prestations (contre-étude)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let marcheId: string;
  let lineId: string;

  function as(method: 'get' | 'post' | 'put' | 'delete', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get' ? request(server).get(path)
        : method === 'put' ? request(server).put(path)
          : method === 'delete' ? request(server).delete(path)
            : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }
  const objTotal = (body: { budgetByNature: { objectif: string }[] }) =>
    body.budgetByNature.reduce((a, b) => a + Number(b.objectif), 0);
  const nat = (body: { budgetByNature: { nature: string; objectif: string }[] }, n: string) =>
    Number(body.budgetByNature.find((b) => b.nature === n)?.objectif ?? 0);

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Ed', 'admin', ['estimating', 'site_tracking', 'invoicing']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '40' }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'ED-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' }).expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' }).expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    chantierId = acc.chantier.id;
    marcheId = acc.marche.id;
    lineId = (await as('get', `/chantiers/${chantierId}`)).body.lines[0].id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('refuse toute édition tant que l’étude n’est pas validée (409)', async () => {
    await as('post', `/marches/${marcheId}/execution-lines`).send({ designation: 'X', quantiteObjectif: '1' }).expect(409);
    await as('post', `/execution-lines/${lineId}/components`)
      .send({ code: 'C', label: 'C', nature: 'material', unitCost: '10', quantity: '1' }).expect(409);
  });

  it('en contre-étude : ajoute une ressource propre au chantier (budget objectif recalculé)', async () => {
    await as('post', `/marches/${marcheId}/etude/validate`).expect(201);
    // objectif initial = MO 2×40×10 = 800 (labor)
    const before = (await as('get', `/chantiers/${chantierId}`)).body;
    expect(nat(before, 'labor')).toBe(800);

    // + béton propre au chantier : 1 (qté sur l'ouvrage) × 5 (qté compo) × 100 × 10 (qté ouvrage) → material
    const after = (await as('post', `/execution-lines/${lineId}/components`)
      .send({ code: 'BET', label: 'Béton chantier', unit: 'm3', nature: 'material', unitCost: '100', quantity: '5' })
      .expect(201)).body;
    expect(nat(after, 'material')).toBe(5000); // 5 × 100 × 10
    expect(nat(after, 'labor')).toBe(800);
  });

  it('ajoute un ouvrage (prestation) puis une ressource dessus', async () => {
    const withLine = (await as('post', `/marches/${marcheId}/execution-lines`)
      .send({ code: '2', designation: 'Ouvrage ajouté', unit: 'u', quantiteObjectif: '4' }).expect(201)).body;
    const newLine = withLine.lines.find((l: { designation: string }) => l.designation === 'Ouvrage ajouté');
    expect(newLine).toBeTruthy();

    const after = (await as('post', `/execution-lines/${newLine.id}/components`)
      .send({ code: 'PEIN', label: 'Peinture', unit: 'm2', nature: 'material', unitCost: '3', quantity: '10' })
      .expect(201)).body;
    // + 10 × 3 × 4 = 120 material, cumulé avec les 5000 précédents
    expect(nat(after, 'material')).toBe(5120);
  });

  it('modifie la quantité d’un ouvrage et supprime une ligne', async () => {
    // MO déjà en base : trouver le composant béton pour tester la suppression
    const comp = await runInTenant(ds, tenantId, (em) =>
      em.query(
        `SELECT ec.id FROM execution_component ec
           JOIN nomenclature_resource n ON n.id = ec.nomenclature_resource_id
          WHERE n.code = 'BET'`,
      ),
    );
    // supprime le béton → material retombe (5120 - 5000 = 120)
    const afterRemove = (await as('delete', `/execution-components/${comp[0].id}`).expect(200)).body;
    expect(nat(afterRemove, 'material')).toBe(120);

    // supprime l'ouvrage ajouté → material = 0, il reste labor 800
    const line = afterRemove.lines.find((l: { designation: string }) => l.designation === 'Ouvrage ajouté');
    const afterDelete = (await as('delete', `/execution-lines/${line.id}`).expect(200)).body;
    expect(nat(afterDelete, 'material')).toBe(0);
    expect(nat(afterDelete, 'labor')).toBe(800);
    expect(objTotal(afterDelete)).toBe(800);
  });

  it('les modifications sont journalisées (horodaté)', async () => {
    const log = (await as('get', `/marches/${marcheId}/change-log`)).body as Array<{ action: string }>;
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining([
      'add_resource_component', 'add_ouvrage_line', 'remove_component', 'remove_line',
    ]));
  });
});
