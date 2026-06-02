import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export interface AdvancementInput {
  /** null/absent = global advancement */
  nature?: string | null;
  /** fraction 0..1 */
  pct: string | number;
  source?: 'manual' | 'situations';
}

/**
 * Chantier advancement input (cahier des charges §5.8). Manual entries (global and/or per
 * nature), or derived from situations. The latest snapshot per (nature) is the current value;
 * the engine uses the per-nature pct when present, else the global one.
 */
@Injectable()
export class AdvancementService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  record(chantierId: string, input: AdvancementInput) {
    const tenantId = this.context.requireTenantId();
    const pct = Number(input.pct);
    if (!(pct >= 0 && pct <= 1)) {
      throw new BadRequestException('pct must be a fraction between 0 and 1');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const c = await em.query(`SELECT id FROM chantier WHERE id = $1`, [chantierId]);
      if (c.length === 0) {
        throw new NotFoundException(`Unknown chantier "${chantierId}"`);
      }
      return (
        await em.query(
          `INSERT INTO chantier_advancement (tenant_id, chantier_id, nature, pct, source)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [tenantId, chantierId, input.nature ?? null, String(pct), input.source ?? 'manual'],
        )
      )[0];
    });
  }

  /** Latest advancement per nature (+ global) for a chantier. */
  current(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT DISTINCT ON (nature) nature, pct, source, recorded_at
           FROM chantier_advancement WHERE chantier_id = $1
          ORDER BY nature, recorded_at DESC`,
        [chantierId],
      );
      const global = rows.find((r: { nature: string | null }) => r.nature === null) ?? null;
      const byNature = rows.filter((r: { nature: string | null }) => r.nature !== null);
      return { global, byNature };
    });
  }
}
