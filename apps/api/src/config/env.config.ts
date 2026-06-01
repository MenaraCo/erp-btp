/**
 * Centralised, typed access to environment configuration.
 * Reading env vars only happens here so the rest of the app stays testable.
 */
export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
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
    },
  };
}
