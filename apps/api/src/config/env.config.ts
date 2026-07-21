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
  /** Whether a payment method is required to start the trial (cahier §3.3, default false). */
  trialRequiresPaymentMethod: boolean;
  /** Secret for signing first-party JWTs. MUST be set via env in production. */
  jwtSecret: string;
  /** Access-token lifetime in seconds. */
  accessTokenTtlSec: number;
  /**
   * Emails allowed into the editor back-office (cahier §3.7 B) — the platform owner's console,
   * strictly separate from client tenants. Set via env PLATFORM_ADMIN_EMAILS (comma-separated).
   * Defaults to the demo admin in dev so the console is testable out of the box.
   */
  platformAdminEmails: string[];
  database: DatabaseConfig;
}

export function loadAppConfig(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.API_PORT ?? 3001),
    tenantBaseDomain: process.env.TENANT_BASE_DOMAIN ?? 'localhost',
    trialRequiresPaymentMethod:
      process.env.TRIAL_REQUIRES_PAYMENT_METHOD === 'true',
    jwtSecret:
      process.env.JWT_SECRET ??
      ((process.env.NODE_ENV ?? 'development') === 'production'
        ? ''
        : 'dev-insecure-jwt-secret-change-me'),
    accessTokenTtlSec: Number(process.env.ACCESS_TOKEN_TTL_SEC ?? 3600),
    platformAdminEmails: (
      process.env.PLATFORM_ADMIN_EMAILS ??
      ((process.env.NODE_ENV ?? 'development') === 'production' ? '' : 'admin@demo.test')
    )
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
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
