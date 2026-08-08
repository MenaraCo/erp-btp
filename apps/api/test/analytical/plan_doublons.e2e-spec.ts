import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { createUser } from '../support/entitlements.helpers';
import { EntitlementsService } from '../../src/core/entitlements/entitlements.service';
import { RbacService } from '../../src/core/rbac/rbac.service';

/**
 * Plan analytique partagé — deux modules y écrivent, un seul plan en sort.
 *
 * Le plan est éditable depuis l'étude de prix ET depuis le chantier : c'est ce qui permet à
 * chacun de travailler sans attendre l'autre. Le risque est mécanique : deux personnes qui ne se
 * voient pas créent la même chose sous deux codes, et l'agrégation analytique compte alors la
 * même dépense sur deux lignes.
 *
 * D'où un barrage sur le CODE (message clair, pas une erreur SQL) et sur le LIBELLÉ normalisé.
 */
describe('Plan analytique — pas de doublon entre étude de prix et chantier', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  /** Le deviseur, qui paramètre depuis Étude de prix. */
  let deviseur: string;
  /** Le conducteur, qui paramètre depuis Chantier — même plan, autre porte. */
  let conducteur: string;

  const MODULES = ['core', 'estimating', 'site_tracking'];

  const as = (method: 'get' | 'post' | 'patch', path: string, userId: string) =>
    request(app.getHttpServer())[method](path)
      .set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId: deviseur } = await entitleUser(app, ds, 'Plan', 'admin', MODULES));
    conducteur = await createUser(ds, tenantId, 'conducteur@plan.test');
    for (const m of MODULES) await app.get(EntitlementsService).assignSeat(tenantId, m, conducteur);
    await app.get(RbacService).assignRole(tenantId, conducteur, 'admin');
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  describe('unités', () => {
    it('le deviseur crée une unité', async () => {
      await as('post', '/params/units', deviseur)
        .send({ abrev: 'M2', label: 'Mètre carré' }).expect(201);
    });

    it("le conducteur ne peut pas la recréer sous une autre abréviation", async () => {
      const r = await as('post', '/params/units', conducteur)
        .send({ abrev: 'MC', label: 'mètre  carré' }).expect(409);
      expect(r.body.message).toContain('Mètre carré');
    });

    it("ni reprendre l'abréviation déjà posée", async () => {
      const r = await as('post', '/params/units', conducteur)
        .send({ abrev: 'M2', label: 'Autre chose' }).expect(409);
      expect(r.body.message).toContain('déjà utilisé');
    });

    it('une unité réellement différente passe', async () => {
      await as('post', '/params/units', conducteur)
        .send({ abrev: 'ML', label: 'Mètre linéaire' }).expect(201);
    });
  });

  describe('plan analytique : lot → famille → code', () => {
    let lotId: string;
    let familleId: string;

    it('le deviseur pose un lot, le conducteur ne le double pas', async () => {
      lotId = (await as('post', '/params/lots', deviseur)
        .send({ code: 'GO', label: 'Gros œuvre' }).expect(201)).body.id;

      // Même chose, écrite autrement : accents et casse ne doivent pas tromper le contrôle.
      const r = await as('post', '/params/lots', conducteur)
        .send({ code: 'GROS', label: 'GROS OEUVRE' }).expect(409);
      expect(r.body.message).toContain('Gros œuvre');
    });

    it('même barrage sur les familles', async () => {
      familleId = (await as('post', '/params/familles', deviseur)
        .send({ lotId, code: 'MAC', label: 'Maçonnerie' }).expect(201)).body.id;

      await as('post', '/params/familles', conducteur)
        .send({ lotId, code: 'MACO', label: 'maçonnerie' }).expect(409);
    });

    it('et sur les codes analytiques — le cas qui fausse les agrégats', async () => {
      await as('post', '/params/codes', deviseur)
        .send({ familleId, code: '280', label: 'Colle' }).expect(201);

      // Le conducteur, de son côté, référence la même dépense sous un autre code.
      const r = await as('post', '/params/codes', conducteur)
        .send({ familleId, code: '281', label: 'COLLE' }).expect(409);
      expect(r.body.message).toContain('Reprenez cette entrée');
    });

    it('un code réellement nouveau reste accepté', async () => {
      await as('post', '/params/codes', conducteur)
        .send({ familleId, code: '282', label: 'Mortier de scellement' }).expect(201);
    });

    it('une entrée peut se renommer elle-même sans se heurter à son propre libellé', async () => {
      const codes = (await as('get', '/params/codes', deviseur).expect(200)).body;
      const colle = codes.find((c: { code: string }) => c.code === '280');
      await as('patch', `/params/codes/${colle.id}`, deviseur)
        .send({ label: 'Colle' }).expect(200);
      // …mais pas prendre le libellé d'une autre.
      await as('patch', `/params/codes/${colle.id}`, deviseur)
        .send({ label: 'Mortier de scellement' }).expect(409);
    });
  });
});
