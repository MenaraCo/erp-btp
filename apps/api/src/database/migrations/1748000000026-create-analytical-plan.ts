import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plan analytique (cahier des charges §5.8, axe analytique) — increment B.0a.
 *
 * The second analysis axis: nature → lot → famille → ressource (= analytical code). Nature is a
 * fixed enum (the 4 cost natures, consistent with resource.nature); lots and familles are the
 * tenant-configurable levels, duplicated from a "plan modèle" template at setup. Strict ascending
 * nesting: a famille belongs to exactly one lot, a lot to exactly one nature.
 *
 * company_id is nullable now (single default société per tenant) and reserved for the future
 * multi-société duplication ("plan modèle dupliqué à la création d'une société"). Tenant-scoped (RLS).
 */
export class CreateAnalyticalPlan1748000000026 implements MigrationInterface {
  name = 'CreateAnalyticalPlan1748000000026';

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
      CREATE TABLE analytical_lot (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        company_id  uuid NULL REFERENCES company(id) ON DELETE CASCADE,
        nature      varchar(16) NOT NULL
                      CHECK (nature IN ('material','equipment','subcontract','labor')),
        code        varchar(64) NOT NULL,
        label       varchar(255) NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, code)
      );
    `);
    await this.enableRls(queryRunner, 'analytical_lot');

    await queryRunner.query(`
      CREATE TABLE analytical_famille (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        company_id  uuid NULL REFERENCES company(id) ON DELETE CASCADE,
        lot_id      uuid NOT NULL REFERENCES analytical_lot(id) ON DELETE CASCADE,
        code        varchar(64) NOT NULL,
        label       varchar(255) NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, code)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_analytical_famille_lot ON analytical_famille(lot_id);`,
    );
    await this.enableRls(queryRunner, 'analytical_famille');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS analytical_famille;`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytical_lot;`);
  }
}
