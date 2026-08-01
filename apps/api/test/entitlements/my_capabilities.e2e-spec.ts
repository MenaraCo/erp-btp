import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { createUser } from '../support/entitlements.helpers';

/**
 * GET /me/capabilities alimente le menu. Il doit dire EXACTEMENT ce que la garde autorise :
 * module actif ET jeton affecté. Sinon l'utilisateur voit une entrée qui mène à un 403.
 */
describe('Entitlements — capacités de l’utilisateur courant (menu)', () => {
  let app: INestApplication;
  let ds: DataSource;

  function as(tenantId: string, userId?: string) {
    const req = request(app.getHttpServer())
      .get('/me/capabilities')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', tenantId);
    return userId ? req.set('X-User-Id', userId) : req;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('renvoie les capacités des modules souscrits ET dotés d’un jeton', async () => {
    const { tenantId, userId } = await entitleUser(app, ds, 'MyCapInv', 'admin', [
      'core',
      'invoicing',
    ]);
    const res = await as(tenantId, userId).expect(200);
    expect(res.body.capabilities).toContain('invoicing.situations');
    // Le suivi de chantier n'est pas souscrit : sa capacité ne doit pas apparaître.
    expect(res.body.capabilities).not.toContain('site_tracking.budget');
    expect(res.body.activeModules).toContain('invoicing');
  });

  it('ne renvoie rien pour un utilisateur sans jeton, même si le module est actif', async () => {
    const { tenantId } = await entitleUser(app, ds, 'MyCapNoSeat', 'admin', ['invoicing']);
    // Second utilisateur du MÊME tenant, à qui aucun jeton n'a été affecté.
    const sansJeton = await createUser(ds, tenantId, 'sans-jeton@mycapnoseat.test');
    const res = await as(tenantId, sansJeton).expect(200);
    expect(res.body.capabilities).toHaveLength(0);
    expect(res.body.activeModules).toContain('invoicing');
  });
});
