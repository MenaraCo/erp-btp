import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * La nomenclature de chantier est unique par (chantier, code). Or un devis peut parfaitement
 * contenir plusieurs ressources SANS code, ou deux ressources de même code, et un chantier peut
 * recevoir plusieurs marchés qui partagent les mêmes ressources. L'acceptation doit absorber tout
 * cela sans jamais échouer sur une collision de code.
 */
describe('Suivi de chantier — la nomenclature absorbe les codes vides ou répétés', () => {
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

  async function saleSheet(versionId: string) {
    await as('put', `/versions/${versionId}/sale-sheet`)
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
  }

  async function win(devisId: string) {
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${devisId}/transition`).send({ to }).expect(201);
    }
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'NomenCode', 'admin', [
      'estimating',
      'site_tracking',
      'invoicing',
    ]));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('accepte un devis contenant plusieurs ressources sans code', async () => {
    const created = (await as('post', '/affaires').send({ code: 'NOM-1', name: 'NOM-1' }).expect(201)).body;
    const vId = created.version.id;
    const titre = (
      await as('post', `/versions/${vId}/lines`)
        .send({ type: 'titre', code: '1', designation: 'T', sortOrder: 1 })
        .expect(201)
    ).body;
    for (const label of ['Sans code A', 'Sans code B', 'Sans code C']) {
      await as('post', `/versions/${vId}/lines`)
        .send({
          type: 'ressource', parentLineId: titre.id, designation: label,
          unit: 'u', quantity: '2', pu: '50', nature: 'labor',
        })
        .expect(201);
    }
    await saleSheet(vId);
    await win(created.devis.id);

    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    expect(acc.executionLineCount).toBeGreaterThan(0);
    const nomen = (await as('get', `/chantiers/${acc.chantier.id}/nomenclature`).expect(200)).body;
    expect(nomen).toHaveLength(3);
    // Trois codes distincts, générés faute de code saisi.
    expect(new Set(nomen.map((n: { code: string }) => n.code)).size).toBe(3);
  });

  it('accepte deux ressources portant le même code dans le même devis', async () => {
    const created = (await as('post', '/affaires').send({ code: 'NOM-2', name: 'NOM-2' }).expect(201)).body;
    const vId = created.version.id;
    const titre = (
      await as('post', `/versions/${vId}/lines`)
        .send({ type: 'titre', code: '1', designation: 'T', sortOrder: 1 })
        .expect(201)
    ).body;
    for (const label of ['Doublon 1', 'Doublon 2']) {
      await as('post', `/versions/${vId}/lines`)
        .send({
          type: 'ressource', parentLineId: titre.id, code: 'DUP', designation: label,
          unit: 'u', quantity: '1', pu: '100', nature: 'material',
        })
        .expect(201);
    }
    await saleSheet(vId);
    await win(created.devis.id);

    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    const nomen = [...(await as('get', `/chantiers/${acc.chantier.id}/nomenclature`).expect(200)).body]
      .sort((a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code));
    expect(nomen).toHaveLength(2);
    expect(nomen[0].code).toBe('DUP');
    expect(nomen[1].code).not.toBe('DUP');
  });

  it('accepte un second marché sur le même chantier avec la même ressource de bibliothèque', async () => {
    const lib = (await as('post', '/libraries').send({ code: 'LNOM', name: 'L' }).expect(201)).body;
    const res = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'RSHARED', label: 'Partagée', unit: 'u', nature: 'material', unitCost: '10' })
        .expect(201)
    ).body;
    const ouv = (
      await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'ONOM', label: 'O', unit: 'u' }).expect(201)
    ).body;
    await as('post', `/ouvrages/${ouv.id}/components`)
      .send({ kind: 'resource', childResourceId: res.id, quantity: '1' })
      .expect(201);

    const build = async (code: string) => {
      const created = (await as('post', '/affaires').send({ code, name: code }).expect(201)).body;
      await as('post', `/versions/${created.version.id}/lines`)
        .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' })
        .expect(201);
      await saleSheet(created.version.id);
      await win(created.devis.id);
      return created.devis.id as string;
    };

    const d1 = await build('NOM-3A');
    const d2 = await build('NOM-3B');
    const first = (await as('post', `/devis/${d1}/accept`).expect(201)).body;
    // Second marché rattaché au MÊME chantier : la ressource partagée ne doit pas casser l'insertion.
    const second = (
      await as('post', `/devis/${d2}/accept`).send({ chantierId: first.chantier.id }).expect(201)
    ).body;
    expect(second.marche.chantier_id).toBe(first.chantier.id);
    const nomen = (await as('get', `/chantiers/${first.chantier.id}/nomenclature`).expect(200)).body;
    expect(nomen.map((n: { code: string }) => n.code)).toEqual(['RSHARED']);
  });
});
