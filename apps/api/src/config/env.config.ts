/**
 * Centralised, typed access to environment configuration.
 * Reading env vars only happens here so the rest of the app stays testable.
 */
export interface DatabaseConfig {
  host: string;
  port: number;
  /** Owner/superuser role — used for DDL and migrations. */
  username: string;
  password: string;
  database: string;
  /** Non-privileged application role (NOBYPASSRLS) — used by the runtime app, subject to RLS. */
  appUsername: string;
  appPassword: string;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  tenantBaseDomain: string;
  database: DatabaseConfig;
}

export function loadAppConfig(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.API_PORT ?? 3001),
    tenantBaseDomain: process.env.TENANT_BASE_DOMAIN ?? 'localhost',
    database: {
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: Number(process.env.DATABASE_PORT ?? 5432),
      username: process.env.DATABASE_USER ?? 'erp',
      password: process.env.DATABASE_PASSWORD ?? 'erp',
      database: process.env.DATABASE_NAME ?? 'erp_btp',
      appUsername: process.env.DATABASE_APP_USER ?? 'erp_app',
      appPassword: process.env.DATABASE_APP_PASSWORD ?? 'erp_app',
    },
  };
}
