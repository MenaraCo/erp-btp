import { DataSource } from 'typeorm';
import { PERMISSIONS } from '../../core/rbac/rbac.config';

/**
 * Seeds the global permission catalogue from rbac.config.ts. Idempotent and reconciling:
 * upserts by key, removes permissions no longer in config. (System roles are per-tenant and
 * provisioned by RbacService, not seeded globally.)
 */
export async function seedPermissions(dataSource: DataSource): Promise<void> {
  const qr = dataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    for (const p of PERMISSIONS) {
      await qr.query(
        `INSERT INTO permission (key, label) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, updated_at = now()`,
        [p.key, p.label],
      );
    }
    await qr.query(`DELETE FROM permission WHERE key <> ALL($1::text[])`, [
      PERMISSIONS.map((p) => p.key),
    ]);
    await qr.commitTransaction();
  } catch (error) {
    await qr.rollbackTransaction();
    throw error;
  } finally {
    await qr.release();
  }
}
