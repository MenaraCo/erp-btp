import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gestion financière (cahier des charges §5.8) — increment B.1. Versioned, parameterizable
 * formula set per tenant (EAC method, alert thresholds), and the chantier advancement input
 * (manual global/per-nature, or derived from situations). Tenant-scoped (RLS).
 */
export class CreateFinancialConfig1748000000025 implements MigrationInterface {
  name = 'CreateFinancialConfig1748000000025';

  private async enableRls(qr: QueryRunner, table: string): Promise<void> {
    await qr.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    await qr.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    await qr.query(`
      CREATE POLICY ${table}_tenant_isolation ON ${table}
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE financial_formula_set (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        version            integer NOT NULL,
        active             boolean NOT NULL DEFAULT true,
        eac_method         varchar(8) NOT NULL DEFAULT 'm1' CHECK (eac_method IN ('m1','m2')),
        ecart_alert_pct    numeric(6,4) NOT NULL DEFAULT -0.05,
        marge_cible_pct    numeric(6,4) NOT NULL DEFAULT 0.05,
        advancement_source varchar(16) NOT NULL DEFAULT 'manual'
                             CHECK (advancement_source IN ('manual','situations')),
        params             jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at         timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, version)
      );
    `);
    await this.enableRls(queryRunner, 'financial_formula_set');

    await queryRunner.query(`
      CREATE TABLE chantier_advancement (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id  uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        nature       varchar(16) NULL
                       CHECK (nature IN ('labor','material','equipment','subcontract','site_overhead')),
        pct          numeric(6,4) NOT NULL DEFAULT 0,
        source       varchar(16) NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('manual','situations')),
        recorded_at  timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_advancement_chantier ON chantier_advancement(chantier_id);`,
    );
    await this.enableRls(queryRunner, 'chantier_advancement');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS chantier_advancement;`);
    await queryRunner.query(`DROP TABLE IF EXISTS financial_formula_set;`);
  }
}
