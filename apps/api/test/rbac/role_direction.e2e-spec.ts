import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { createUser } from '../support/entitlements.helpers';
import { RbacService } from '../../src/core/rbac/rbac.service';
import { EntitlementsService } from '../../src/core/entitlements/entitlements.service';

/**
 * Rôle « Direction » — voir toute la société, ne rien pouvoir casser.
 *
 * Jusqu'ici, seul l'Administrateur voyait l'ensemble (facturation, chantiers, financier), mais il
 * pouvait aussi tout modifier, gérer les rôles et gérer l'abonnement. Un dirigeant qui veut
 * surveiller n'a pas à porter ce pouvoir : d'où un rôle de LECTURE sur toute la chaîne.
 *
 * Les jetons restent l'autre verrou : ce rôle ne donne accès qu'aux modules effectivement
 * souscrits ET affectés à la personne.
 */
describe('RBAC — rôle Direction : lecture de bout en bout, écriture nulle part', () => {
  let app: INestApplication;
  let ds: DataSource;
  /** Le dirigeant : jetons sur toute la chaîne, rôle direction. */
  let dir: { tenantId: string; userId: string };
  /** Un administrateur du MÊME tenant, pour créer la matière à consulter. */
  let adminId: string;

  const MODULES = ['core', 'estimating', 'invoicing', 'site_tracking', 'financial_management'];

  function as(method: 'get' | 'post' | 'put' | 'patch', path: string, userId: string) {
    return request(app.getHttpServer())[method](path)
      .set('Host', 'localhost')
      .set('X-Tenant-Id', dir.tenantId)
      .set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    dir = await entitleUser(app, ds, 'Dir', 'direction', MODULES);
    // Un collègue administrateur DANS LA MÊME société — c'est tout l'objet du test : le dirigeant
    // doit voir ce que les autres produisent. `entitleUser` créerait une société à part, donc on
    // monte l'utilisateur à la main dans celle du dirigeant (compte + jetons + rôle).
    adminId = await createUser(ds, dir.tenantId, `collegue@${dir.tenantId.slice(0, 8)}.test`);
    for (const code of MODULES) {
      await app.get(EntitlementsService).assignSeat(dir.tenantId, code, adminId);
    }
    await app.get(RbacService).assignRole(dir.tenantId, adminId, 'admin');
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('le rôle est provisionné avec cinq permissions, toutes en lecture', async () => {
    const roles = await app.get(RbacService).listRoles(dir.tenantId);
    const direction = roles.find((r) => r.code === 'direction');
    expect(direction).toBeDefined();
    expect(direction!.isSystem).toBe(true);
    expect([...direction!.permissions].sort()).toEqual([
      'directory.read',
      'estimating.devis.read',
      'financial.read',
      'invoicing.read',
      'site_tracking.read',
    ]);
    // La garantie du rôle : aucune permission d'écriture ni d'administration.
    expect(direction!.permissions.some((p) => /\.write$|manage|assign/.test(p))).toBe(false);
  });

  it('lit toute la chaîne : devis, facturation, chantiers, portefeuille Direction', async () => {
    await as('get', '/devis', dir.userId).expect(200);
    await as('get', '/affaires', dir.userId).expect(200);
    await as('get', '/clients', dir.userId).expect(200);
    await as('get', '/marches', dir.userId).expect(200);
    await as('get', '/chantiers', dir.userId).expect(200);
    // L'écran Direction lui-même — c'est LA raison d'être du rôle.
    await as('get', '/financial/portfolio', dir.userId).expect(200);
  });

  it('voit le travail des AUTRES, pas seulement le sien', async () => {
    // L'administrateur crée une affaire ; le dirigeant, qui n'y a pas touché, doit la voir.
    const code = `DIR-${Date.now().toString().slice(-6)}`;
    await as('post', '/affaires', adminId).send({ code, name: 'Affaire du collègue' }).expect(201);

    const vues = (await as('get', '/affaires?pageSize=200', dir.userId).expect(200)).body;
    expect(vues.rows.some((a: { code: string }) => a.code === code)).toBe(true);
  });

  it("n'écrit nulle part : devis, chantiers, facturation, référentiel (403)", async () => {
    await as('post', '/affaires', dir.userId).send({ code: 'DIR-KO', name: 'Interdit' }).expect(403);
    await as('post', '/clients', dir.userId).send({ code: 'C-KO', name: 'Interdit' }).expect(403);
    await as('post', '/chantiers', dir.userId).send({ code: 'CH-KO', name: 'Interdit' }).expect(403);
  });

  it("n'administre rien : la console des jetons lui est fermée (403)", async () => {
    // La console des rôles (/admin/users) vit dans UsersModule, hors de l'app de test du socle :
    // la console des jetons suffit à prouver la règle, elles portent la même famille de droits.
    await as('get', '/seats', dir.userId).expect(403);
    await as('post', '/seats', dir.userId)
      .send({ moduleCode: 'estimating', userId: dir.userId })
      .expect(403);
  });

  it('sans jeton du module, le rôle ne suffit pas (les deux verrous tiennent)', async () => {
    // Même rôle direction, mais aucun jeton sur la chaîne métier : la garde de capacité refuse.
    const sansJeton = await entitleUser(app, ds, 'DirNu', 'direction', 'core');
    await request(app.getHttpServer())
      .get('/financial/portfolio')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', sansJeton.tenantId)
      .set('X-User-Id', sansJeton.userId)
      .expect(403);
  });
});
