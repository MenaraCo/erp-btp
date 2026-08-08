import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

/**
 * Transfert entre la bibliothèque d'ÉTUDE DE PRIX et celle du MODULE CHANTIER.
 *
 * Deux catalogues de référence de l'entreprise, volontairement distincts — on ne chiffre pas avec
 * les mêmes prix qu'on exécute. Rien ne se synchronise tout seul ; cet outil est la seule voie de
 * circulation, et elle est explicite.
 *
 * À ne pas confondre avec la nomenclature d'UN chantier, copie de travail reçue à l'acceptation :
 * elle ne participe pas à ce transfert.
 */
describe('Transfert de bibliothèque — étude ↔ module chantier', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let bibEtude: string;
  let bibChantier: string;

  const as = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](path)
      .set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);

  const creerBib = async (code: string, name: string, scope: 'etude' | 'chantier') =>
    (await as('post', '/libraries').send({ code, name, scope }).expect(201)).body.id;

  const ajouter = (libId: string, code: string, label: string, prix: string, nature = 'material') =>
    as('post', `/libraries/${libId}/resources`)
      .send({ code, label, unit: 'U', nature, unitCost: prix }).expect(201);

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Transf', 'admin', [
      'core', 'estimating', 'site_tracking',
    ]));

    bibEtude = await creerBib('ETU', 'Bibliothèque d’étude', 'etude');
    bibChantier = await creerBib('CHA', 'Bibliothèque chantier', 'chantier');

    await ajouter(bibEtude, 'CIM', 'Ciment', '0.14');
    await ajouter(bibEtude, 'SAB', 'Sable', '28');
    // Article né côté chantier, à un prix réellement obtenu.
    await ajouter(bibChantier, 'BENNE', 'Benne 8m³', '165', 'equipment');
    // Un code commun aux deux : il doit être signalé, jamais écrasé.
    await ajouter(bibChantier, 'CIM', 'Ciment (prix chantier)', '0.11');
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('chaque module ne voit QUE ses bibliothèques', async () => {
    const etude = (await as('get', '/libraries?pageSize=50').expect(200)).body;
    expect(etude.rows.map((l: { code: string }) => l.code)).toEqual(['ETU']);

    const chantier = (await as('get', '/libraries?pageSize=50&scope=chantier').expect(200)).body;
    expect(chantier.rows.map((l: { code: string }) => l.code)).toEqual(['CHA']);

    const cibles = (await as('get', '/transfert-bibliotheque/bibliotheques-chantier').expect(200)).body;
    expect(cibles.map((l: { code: string }) => l.code)).toEqual(['CHA']);
  });

  describe('étude → chantier', () => {
    const apercu = async () =>
      (await as('get', `/transfert-bibliotheque/vers-chantier/apercu?sourceId=${bibEtude}&cibleId=${bibChantier}`)
        .expect(200)).body;

    it('distingue ce qui manque de ce que la cible possède déjà', async () => {
      const a = await apercu();
      expect(a.find((c: { code: string }) => c.code === 'CIM').etat).toBe('deja_present');
      expect(a.find((c: { code: string }) => c.code === 'SAB').etat).toBe('transferable');
    });

    it('copie l’article manquant sans toucher à celui qui existe', async () => {
      const ids = (await apercu()).map((c: { id: string }) => c.id);

      const r = (await as('post', '/transfert-bibliotheque/vers-chantier')
        .send({ sourceId: bibEtude, cibleId: bibChantier, ids }).expect(201)).body;
      expect(r).toMatchObject({ transferes: 1, ignores: 1, codesIgnores: ['CIM'] });

      const rows = await runInTenant(ds, tenantId, (em) =>
        em.query(`SELECT code, label, unit_cost FROM resource WHERE library_id = $1 ORDER BY code`, [bibChantier]));
      expect(rows.find((x: { code: string }) => x.code === 'SAB')).toBeTruthy();
      // Le ciment du chantier a gardé SON prix négocié, pas celui de l'étude.
      const cim = rows.find((x: { code: string }) => x.code === 'CIM');
      expect(Number(cim.unit_cost)).toBeCloseTo(0.11, 4);
      expect(cim.label).toBe('Ciment (prix chantier)');
    });
  });

  describe('chantier → étude', () => {
    it('remonte un article du terrain au catalogue de chiffrage', async () => {
      const a = (await as('get', `/transfert-bibliotheque/vers-etude/apercu?sourceId=${bibChantier}&cibleId=${bibEtude}`)
        .expect(200)).body;
      const benne = a.find((c: { code: string }) => c.code === 'BENNE');
      expect(benne.etat).toBe('transferable');
      expect(Number(benne.prix)).toBeCloseTo(165, 2);

      await as('post', '/transfert-bibliotheque/vers-etude')
        .send({ sourceId: bibChantier, cibleId: bibEtude, ids: [benne.id] }).expect(201);

      const [r] = await runInTenant(ds, tenantId, (em) =>
        em.query(`SELECT unit_cost, nature FROM resource WHERE library_id = $1 AND code = 'BENNE'`, [bibEtude]));
      expect(Number(r.unit_cost)).toBeCloseTo(165, 2);
      expect(r.nature).toBe('equipment');
    });
  });

  describe('le sens demandé doit correspondre à la portée réelle', () => {
    it("refuse d'écrire dans une bibliothèque d'étude par la porte du chantier", async () => {
      // Sans ce contrôle, la garde de l'endpoint ne protégerait rien.
      const r = await as('get', `/transfert-bibliotheque/vers-chantier/apercu?sourceId=${bibChantier}&cibleId=${bibEtude}`)
        .expect(400);
      // Les deux extrémités sont inversées ; la source est signalée la première.
      expect(r.body.message).toContain('La source doit être une bibliothèque d’étude de prix');
    });

    it("refuse d'écrire dans une bibliothèque de chantier par la porte de l'étude", async () => {
      await as('get', `/transfert-bibliotheque/vers-etude/apercu?sourceId=${bibEtude}&cibleId=${bibChantier}`)
        .expect(400);
    });
  });

  it('refuse une sélection vide, une cible manquante ou la même des deux côtés', async () => {
    await as('post', '/transfert-bibliotheque/vers-chantier')
      .send({ sourceId: bibEtude, cibleId: bibChantier, ids: [] }).expect(400);
    await as('post', '/transfert-bibliotheque/vers-chantier').send({ ids: ['x'] }).expect(400);
    await as('post', '/transfert-bibliotheque/vers-etude')
      .send({ sourceId: bibEtude, cibleId: bibEtude, ids: ['x'] }).expect(400);
  });

  it('gating : sans le suivi de chantier, on n’écrit pas dans son catalogue (403)', async () => {
    const autre = await entitleUser(app, ds, 'TransfKO', 'admin', ['core', 'estimating']);
    await request(app.getHttpServer())
      .get(`/transfert-bibliotheque/vers-chantier/apercu?sourceId=${bibEtude}&cibleId=${bibChantier}`)
      .set('Host', 'localhost')
      .set('X-Tenant-Id', autre.tenantId)
      .set('X-User-Id', autre.userId)
      .expect(403);
  });
});
