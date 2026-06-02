import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export interface FormulaSetInput {
  eacMethod?: 'm1' | 'm2';
  ecartAlertPct?: string | number;
  margeCiblePct?: string | number;
  advancementSource?: 'manual' | 'situations';
}

/**
 * Versioned, parameterizable formula set per tenant (cahier des charges §5.8 / rule #9).
 * The indicator algorithms live in the pure engine (B.2); this holds the tunable parameters
 * (EAC method, alert thresholds, advancement source). Updates create a new version (history kept).
 */
@Injectable()
export class FinancialConfigService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  getActiveFormulaSet(tenantId = this.context.requireTenantId()) {
    return runInTenant(this.dataSource, tenantId, (em) => this.ensureActive(em, tenantId));
  }

  updateFormulaSet(input: FormulaSetInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const current = await this.ensureActive(em, tenantId);
      await em.query(`UPDATE financial_formula_set SET active = false WHERE tenant_id = $1`, [
        tenantId,
      ]);
      return (
        await em.query(
          `INSERT INTO financial_formula_set
             (tenant_id, version, active, eac_method, ecart_alert_pct, marge_cible_pct, advancement_source)
           VALUES ($1, $2, true, $3, $4, $5, $6) RETURNING *`,
          [
            tenantId,
            Number(current.version) + 1,
            input.eacMethod ?? current.eac_method,
            input.ecartAlertPct != null ? String(input.ecartAlertPct) : current.ecart_alert_pct,
            input.margeCiblePct != null ? String(input.margeCiblePct) : current.marge_cible_pct,
            input.advancementSource ?? current.advancement_source,
          ],
        )
      )[0];
    });
  }

  private async ensureActive(em: EntityManager, tenantId: string) {
    const rows = await em.query(
      `SELECT * FROM financial_formula_set WHERE tenant_id = $1 AND active = true LIMIT 1`,
      [tenantId],
    );
    if (rows.length > 0) {
      return rows[0];
    }
    return (
      await em.query(
        `INSERT INTO financial_formula_set (tenant_id, version, active) VALUES ($1, 1, true) RETURNING *`,
        [tenantId],
      )
    )[0];
  }
}
