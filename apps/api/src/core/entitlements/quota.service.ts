import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runInTenant } from '../tenancy/tenant-transaction';
import { QuotaExceededException } from './quota-exceeded.exception';

/**
 * Quota checks (layer 2 of enforcement, cahier des charges §3.5): call assertWithinQuota
 * BEFORE a creation action, then incrementUsage once it succeeds. A metric with no
 * configured limit is treated as unlimited.
 */
@Injectable()
export class QuotaService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  assertWithinQuota(
    tenantId: string,
    metricKey: string,
    increment = 1,
  ): Promise<void> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const limitRows = await em.query(
        `SELECT limit_value FROM tenant_quota WHERE metric_key = $1`,
        [metricKey],
      );
      if (limitRows.length === 0) {
        return; // no limit defined -> unlimited
      }
      const limit = Number(limitRows[0].limit_value);
      const usageRows = await em.query(
        `SELECT current_value FROM usage_counter WHERE metric_key = $1`,
        [metricKey],
      );
      const current = usageRows.length ? Number(usageRows[0].current_value) : 0;
      if (current + increment > limit) {
        throw new QuotaExceededException(metricKey, limit, current);
      }
    });
  }

  incrementUsage(tenantId: string, metricKey: string, delta = 1): Promise<void> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await em.query(
        `INSERT INTO usage_counter (tenant_id, metric_key, current_value)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, metric_key)
         DO UPDATE SET current_value = usage_counter.current_value + EXCLUDED.current_value,
                       updated_at = now()`,
        [tenantId, metricKey, delta],
      );
    });
  }
}
