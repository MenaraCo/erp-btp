import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

interface Me {
  capabilities: string[];
  activeModules: string[];
  permissions: string[];
}

/**
 * `/me/capabilities` doit dire à l'écran ce que l'utilisateur a le droit de FAIRE, pas seulement
 * à quels modules il accède. Sans cela le front ne connaît que les jetons : il affiche les boutons
 * d'écriture à tout le monde et un rôle en lecture récolte un 403 au clic.
 *
 * Ce n'est qu'un miroir : la décision d'accès reste celle des gardes serveur.
 */
describe('/me/capabilities — les permissions descendent jusqu’à l’écran', () => {
  let app: INestApplication;
  let ds: DataSource;

  const me = (t: string, u: string) =>
    request(app.getHttpServer())
      .get('/me/capabilities')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', t)
      .set('X-User-Id', u);

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it("un deviseur reçoit ses permissions d'écriture sur les devis", async () => {
    const u = await entitleUser(app, ds, 'MeEst', 'estimator', 'estimating');
    const body: Me = (await me(u.tenantId, u.userId).expect(200)).body;
    expect(body.permissions).toContain('estimating.devis.write');
    expect(body.permissions).toContain('estimating.devis.read');
    // Il ne gère ni les rôles ni l'abonnement : l'écran ne doit pas lui proposer ces actions.
    expect(body.permissions).not.toContain('rbac.role.manage');
    expect(body.permissions).not.toContain('subscription.manage');
  });

  it("un dirigeant ne reçoit que de la lecture — aucun bouton d'écriture à afficher", async () => {
    const u = await entitleUser(app, ds, 'MeDir', 'direction', 'estimating');
    const body: Me = (await me(u.tenantId, u.userId).expect(200)).body;
    expect(body.permissions).toContain('financial.read');
    expect(body.permissions.some((p) => p.endsWith('.write'))).toBe(false);
  });

  it('les rôles se cumulent sans doublon', async () => {
    const u = await entitleUser(app, ds, 'MeCumul', 'direction', 'estimating');
    // On ajoute Deviseur par-dessus Direction : les deux portent estimating.devis.read.
    const { RbacService } = await import('../../src/core/rbac/rbac.service');
    await app.get(RbacService).assignRole(u.tenantId, u.userId, 'estimator');

    const body: Me = (await me(u.tenantId, u.userId).expect(200)).body;
    expect(body.permissions).toContain('estimating.devis.write'); // apporté par Deviseur
    expect(body.permissions).toContain('financial.read'); // apporté par Direction
    expect(new Set(body.permissions).size).toBe(body.permissions.length);
  });

  it('un utilisateur sans rôle ne reçoit aucune permission', async () => {
    const u = await entitleUser(app, ds, 'MeNu', 'viewer', 'estimating');
    const { RbacService } = await import('../../src/core/rbac/rbac.service');
    await app.get(RbacService).revokeRole(u.tenantId, u.userId, 'viewer');
    const body: Me = (await me(u.tenantId, u.userId).expect(200)).body;
    expect(body.permissions).toEqual([]);
  });
});
