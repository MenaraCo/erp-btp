import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Cycle de vie du suivi d'exécution (cahier §5.5) : étude → contre-étude → exécution, chaque
 * validation horodatée et journalisée ; l'édition n'est possible qu'en phase contre-étude.
 */
describe('Site-tracking — cycle de vie d’exécution (3 phases + horodatage)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let marcheId: string;
  let nomencMoId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get' ? request(server).get(path)
        : method === 'put' ? request(server).put(path)
          : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Ph', 'admin', ['estimating', 'site_tracking', 'invoicing']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '40' }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'PH-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' }).expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' }).expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    chantierId = acc.chantier.id;
    marcheId = acc.marche.id;
    nomencMoId = (await as('get', `/chantiers/${chantierId}/nomenclature`).expect(200)).body
      .find((n: { code: string }) => n.code === 'MO').id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('démarre en phase étude ; l’édition est bloquée tant que l’étude n’est pas validée (409)', async () => {
    const marches = (await as('get', `/chantiers/${chantierId}/marches`).expect(200)).body;
    expect(marches[0].execution_phase).toBe('etude');
    await as('put', `/chantiers/${chantierId}/nomenclature/${nomencMoId}`).send({ unitCostObjectif: '50' }).expect(409);
  });

  it('valide le budget d’étude → phase contre-étude (horodatée), l’édition est permise', async () => {
    const res = (await as('post', `/marches/${marcheId}/etude/validate`).expect(201)).body;
    const marche = (await as('get', `/chantiers/${chantierId}/marches`).expect(200)).body[0];
    expect(marche.execution_phase).toBe('contre_etude');
    expect(marche.etude_validated_at).toBeTruthy();
    expect(res.chantier).toBeDefined();
    // re-valider l’étude est refusé
    await as('post', `/marches/${marcheId}/etude/validate`).expect(409);
    // édition désormais possible
    await as('put', `/chantiers/${chantierId}/nomenclature/${nomencMoId}`).send({ unitCostObjectif: '50' }).expect(200);
  });

  it('valide la contre-étude → phase exécution (horodatée) ; l’édition est figée (409)', async () => {
    await as('post', `/marches/${marcheId}/contre-etude/validate`).expect(201);
    const marche = (await as('get', `/chantiers/${chantierId}/marches`).expect(200)).body[0];
    expect(marche.execution_phase).toBe('execution');
    expect(marche.contre_etude_validated_at).toBeTruthy();
    await as('put', `/chantiers/${chantierId}/nomenclature/${nomencMoId}`).send({ unitCostObjectif: '60' }).expect(409);
  });

  it('journalise chaque action de façon horodatée', async () => {
    const log = (await as('get', `/marches/${marcheId}/change-log`).expect(200)).body as Array<{
      action: string; created_at: string; actor_user_id: string | null;
    }>;
    const actions = log.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining([
      'validate_etude', 'renegotiate_resource', 'validate_contre_etude',
    ]));
    expect(log.every((l) => Boolean(l.created_at))).toBe(true);
    // le plus récent d'abord (tri décroissant)
    expect(actions[0]).toBe('validate_contre_etude');
  });
});
