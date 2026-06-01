import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';

/** App-role DataSource (subject to RLS) — the default for tenant-scoped tests. */
export async function createTestDataSource(): Promise<DataSource> {
  const ds = new DataSource(buildTypeOrmOptions('app'));
  await ds.initialize();
  return ds;
}

/** Owner-role DataSource (bypasses RLS, can run DDL) — for setup/teardown only. */
export async function createOwnerDataSource(): Promise<DataSource> {
  const ds = new DataSource(buildTypeOrmOptions('owner'));
  await ds.initialize();
  return ds;
}

/** Inserts a tenant directly (the tenant table is the root table, no RLS) and returns its id. */
export async function createTenant(
  ds: DataSource,
  name = 'Test Tenant',
): Promise<{ id: string; slug: string }> {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const rows = await ds.query(
    `INSERT INTO tenant (slug, name) VALUES ($1, $2) RETURNING id`,
    [slug, name],
  );
  return { id: rows[0].id, slug };
}
