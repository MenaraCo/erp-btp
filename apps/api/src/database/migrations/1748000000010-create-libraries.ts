import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Estimating libraries and resources (cahier des charges §5.1).
 * A resource is the elementary building block (code, unit, déboursé unitaire, nature).
 * Tenant-scoped (RLS: ENABLE + FORCE + current_tenant policy). Monetary/quantity columns are
 * NUMERIC (never float) — computed with decimal.js from increment 1.2 onwards.
 */
export class CreateLibraries1748000000010 implements MigrationInterface {
  name = 'CreateLibraries1748000000010';

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
      CREATE TABLE library (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        code        varchar(64) NOT NULL,
        name        varchar(255) NOT NULL,
        description text NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz NULL,
        UNIQUE (tenant_id, code)
      );
    `);
    await this.enableRls(queryRunner, 'library');

    await queryRunner.query(`
      CREATE TABLE resource (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        library_id  uuid NOT NULL REFERENCES library(id) ON DELETE CASCADE,
        code        varchar(64) NOT NULL,
        label       varchar(255) NOT NULL,
        unit        varchar(16) NOT NULL,
        nature      varchar(16) NOT NULL
                      CHECK (nature IN ('labor', 'material', 'equipment', 'subcontract')),
        unit_cost   numeric(14,4) NOT NULL DEFAULT 0,
        output      numeric(14,6) NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz NULL,
        UNIQUE (tenant_id, library_id, code)
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_resource_library ON resource(library_id);`);
    await this.enableRls(queryRunner, 'resource');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS resource;`);
    await queryRunner.query(`DROP TABLE IF EXISTS library;`);
  }
}
