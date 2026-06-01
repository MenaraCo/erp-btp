import { DataSource } from 'typeorm';

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Provisions the non-privileged application role used by the runtime connection.
 *
 * The role is NOSUPERUSER / NOBYPASSRLS so Row-Level Security actually applies to it
 * (a superuser, or the table owner running migrations, would bypass RLS).
 * Idempotent and safe to run before or after migrations: it grants on existing tables
 * AND sets default privileges so tables created later by the owner are auto-granted.
 *
 * Must be executed with an owner/superuser connection.
 */
export async function provisionAppRole(
  ownerDataSource: DataSource,
  appUser: string,
  appPassword: string,
): Promise<void> {
  if (!IDENT_RE.test(appUser)) {
    throw new Error(`Invalid application role name: ${appUser}`);
  }
  const pw = appPassword.replace(/'/g, "''");

  const statements = [
    `DO $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUser}') THEN
           CREATE ROLE ${appUser} LOGIN PASSWORD '${pw}' NOSUPERUSER NOBYPASSRLS;
         END IF;
       END
     $$;`,
    `GRANT USAGE ON SCHEMA public TO ${appUser};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appUser};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appUser};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appUser};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO ${appUser};`,
  ];

  for (const sql of statements) {
    await ownerDataSource.query(sql);
  }
}
