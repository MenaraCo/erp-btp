import { DataSource } from 'typeorm';
import {
  createTestDataSource,
  createOwnerDataSource,
  createTenant,
} from '../support/datasource';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

/**
 * Prouve que c'est bien la Row-Level Security (et non un filtre applicatif) qui protège :
 * - via le rôle applicatif (NOBYPASSRLS), une requête SANS contexte tenant ne renvoie rien ;
 * - si le propriétaire désactive la RLS, la même requête fuit toutes les lignes (test négatif) ;
 * on réactive ensuite la RLS pour ne pas polluer les autres tests (suite en série).
 */
describe('RLS isolation — la RLS bloque même sans filtre applicatif', () => {
  let appDs: DataSource;
  let ownerDs: DataSource;
  let tenant: { id: string; slug: string };

  beforeAll(async () => {
    appDs = await createTestDataSource();
    ownerDs = await createOwnerDataSource();
    tenant = await createTenant(appDs, 'Tenant RLS');
    await runInTenant(appDs, tenant.id, (em) =>
      em.query(`INSERT INTO demo_record (tenant_id, label) VALUES ($1, 'secret')`, [
        tenant.id,
      ]),
    );
  });

  afterAll(async () => {
    // Safety net: ensure RLS is enabled even if the negative test threw mid-way.
    await ownerDs.query(`ALTER TABLE demo_record ENABLE ROW LEVEL SECURITY`);
    await ownerDs.query(`ALTER TABLE demo_record FORCE ROW LEVEL SECURITY`);
    await appDs.destroy();
    await ownerDs.destroy();
  });

  it('sans contexte tenant, un SELECT sans WHERE ne renvoie aucune ligne', async () => {
    const rows = await appDs.query(`SELECT * FROM demo_record`);
    expect(rows).toHaveLength(0);
  });

  it('si la RLS est désactivée, la même requête fuit les données (preuve que la RLS protège)', async () => {
    await ownerDs.query(`ALTER TABLE demo_record DISABLE ROW LEVEL SECURITY`);
    try {
      const leaked = await appDs.query(`SELECT * FROM demo_record`);
      expect(leaked.length).toBeGreaterThan(0);
    } finally {
      await ownerDs.query(`ALTER TABLE demo_record ENABLE ROW LEVEL SECURITY`);
      await ownerDs.query(`ALTER TABLE demo_record FORCE ROW LEVEL SECURITY`);
    }
  });
});
