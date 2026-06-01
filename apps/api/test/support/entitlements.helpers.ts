import { DataSource } from 'typeorm';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

/** Test helpers to set up entitlement state (all written inside the tenant's RLS context). */

export function createUser(
  ds: DataSource,
  tenantId: string,
  email: string,
): Promise<string> {
  return runInTenant(ds, tenantId, async (em) => {
    const rows = await em.query(
      `INSERT INTO user_account (tenant_id, email, full_name) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, email, email],
    );
    return rows[0].id as string;
  });
}

export function activateModule(
  ds: DataSource,
  tenantId: string,
  moduleCode: string,
  seatsPurchased: number,
): Promise<void> {
  return runInTenant(ds, tenantId, async (em) => {
    await em.query(
      `INSERT INTO tenant_module (tenant_id, module_code, seats_purchased, active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (tenant_id, module_code)
       DO UPDATE SET seats_purchased = EXCLUDED.seats_purchased, active = true`,
      [tenantId, moduleCode, seatsPurchased],
    );
  });
}

export function setQuota(
  ds: DataSource,
  tenantId: string,
  metricKey: string,
  limit: number,
): Promise<void> {
  return runInTenant(ds, tenantId, async (em) => {
    await em.query(
      `INSERT INTO tenant_quota (tenant_id, metric_key, limit_value)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, metric_key) DO UPDATE SET limit_value = EXCLUDED.limit_value`,
      [tenantId, metricKey, limit],
    );
  });
}
