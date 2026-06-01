import { DataSource } from 'typeorm';
import { createTestDataSource, createTenant } from '../support/datasource';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

/** La clause WITH CHECK de la policy interdit d'écrire une ligne pour un autre tenant. */
describe('RLS isolation — l’écriture force le tenant courant', () => {
  let ds: DataSource;
  let tenantA: { id: string; slug: string };
  let tenantB: { id: string; slug: string };

  beforeAll(async () => {
    ds = await createTestDataSource();
    tenantA = await createTenant(ds, 'Tenant A write');
    tenantB = await createTenant(ds, 'Tenant B write');
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('insérer une ligne pour un autre tenant que le contexte courant est rejeté', async () => {
    await expect(
      runInTenant(ds, tenantA.id, (em) =>
        em.query(
          `INSERT INTO demo_record (tenant_id, label) VALUES ($1, 'forged')`,
          [tenantB.id],
        ),
      ),
    ).rejects.toThrow();
  });

  it('insérer une ligne pour le tenant courant est accepté', async () => {
    await expect(
      runInTenant(ds, tenantA.id, (em) =>
        em.query(
          `INSERT INTO demo_record (tenant_id, label) VALUES ($1, 'legit')`,
          [tenantA.id],
        ),
      ),
    ).resolves.toBeDefined();
  });
});
