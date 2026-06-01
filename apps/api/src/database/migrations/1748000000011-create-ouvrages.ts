import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Composed ouvrages (cahier des charges §5.1, the "entité reine"). An ouvrage is a recursive
 * composition of resources and sub-ouvrages, plus optional percentage lines. Its déboursé sec
 * is cached in ouvrage.debourse (NUMERIC) and recomputed on every change (critical rule #1).
 * Tenant-scoped (RLS: ENABLE + FORCE + current_tenant policy).
 */
export class CreateOuvrages1748000000011 implements MigrationInterface {
  name = 'CreateOuvrages1748000000011';

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
      CREATE TABLE ouvrage (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        library_id  uuid NOT NULL REFERENCES library(id) ON DELETE CASCADE,
        code        varchar(64) NOT NULL,
        label       varchar(255) NOT NULL,
        unit        varchar(16) NOT NULL,
        debourse    numeric(14,4) NOT NULL DEFAULT 0,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz NULL,
        UNIQUE (tenant_id, library_id, code)
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_ouvrage_library ON ouvrage(library_id);`);
    await this.enableRls(queryRunner, 'ouvrage');

    await queryRunner.query(`
      CREATE TABLE ouvrage_component (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        parent_ouvrage_id  uuid NOT NULL REFERENCES ouvrage(id) ON DELETE CASCADE,
        kind               varchar(16) NOT NULL
                             CHECK (kind IN ('resource', 'sub_ouvrage', 'percentage')),
        child_resource_id  uuid NULL REFERENCES resource(id) ON DELETE CASCADE,
        child_ouvrage_id   uuid NULL REFERENCES ouvrage(id) ON DELETE CASCADE,
        quantity           numeric(14,4) NULL,
        rate               numeric(9,6) NULL,
        sort_order         integer NOT NULL DEFAULT 0,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_component_parent ON ouvrage_component(parent_ouvrage_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_component_child_ouvrage ON ouvrage_component(child_ouvrage_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_component_child_resource ON ouvrage_component(child_resource_id);`,
    );
    await this.enableRls(queryRunner, 'ouvrage_component');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ouvrage_component;`);
    await queryRunner.query(`DROP TABLE IF EXISTS ouvrage;`);
  }
}
