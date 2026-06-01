import { DataSource } from 'typeorm';
import { createTestDataSource, createTenant } from '../support/datasource';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

describe('RLS isolation — un tenant ne lit pas les données d’un autre', () => {
  let ds: DataSource;
  let tenantA: { id: string; slug: string };
  let tenantB: { id: string; slug: string };

  beforeAll(async () => {
    ds = await createTestDataSource();
    tenantA = await createTenant(ds, 'Tenant A');
    tenantB = await createTenant(ds, 'Tenant B');

    await runInTenant(ds, tenantA.id, (em) =>
      em.query(
        `INSERT INTO demo_record (tenant_id, label) VALUES ($1, 'a1'), ($1, 'a2')`,
        [tenantA.id],
      ),
    );
    await runInTenant(ds, tenantB.id, (em) =>
      em.query(
        `INSERT INTO demo_record (tenant_id, label) VALUES ($1, 'b1'), ($1, 'b2'), ($1, 'b3')`,
        [tenantB.id],
      ),
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('en contexte tenant A, seules les lignes de A sont visibles', async () => {
    const rows = await runInTenant(ds, tenantA.id, (em) =>
      em.query(`SELECT label FROM demo_record ORDER BY label`),
    );
    expect(rows.map((r: { label: string }) => r.label)).toEqual(['a1', 'a2']);
  });

  it('en contexte tenant B, seules les lignes de B sont visibles', async () => {
    const rows = await runInTenant(ds, tenantB.id, (em) =>
      em.query(`SELECT label FROM demo_record ORDER BY label`),
    );
    expect(rows.map((r: { label: string }) => r.label)).toEqual(['b1', 'b2', 'b3']);
  });
});
