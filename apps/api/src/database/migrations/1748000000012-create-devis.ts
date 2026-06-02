import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Estimating affaires/études (cahier des charges §5.2): an affaire has versions; each version
 * holds a hierarchical devis tree (Titre → Sous-titre → Ouvrage → Ressource) and métré
 * variables. Tenant-scoped (RLS: ENABLE + FORCE + current_tenant policy).
 * Workflow status lives here but its state machine is enforced in increment 1.5.
 */
export class CreateDevis1748000000012 implements MigrationInterface {
  name = 'CreateDevis1748000000012';

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
      CREATE TABLE affaire (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        code        varchar(64) NOT NULL,
        name        varchar(255) NOT NULL,
        client_id   uuid NULL REFERENCES client(id) ON DELETE SET NULL,
        moa         varchar(255) NULL,
        status      varchar(32) NOT NULL DEFAULT 'open',
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz NULL,
        UNIQUE (tenant_id, code)
      );
    `);
    await this.enableRls(queryRunner, 'affaire');

    await queryRunner.query(`
      CREATE TABLE affaire_version (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        affaire_id  uuid NOT NULL REFERENCES affaire(id) ON DELETE CASCADE,
        version_no  integer NOT NULL,
        label       varchar(255) NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (affaire_id, version_no)
      );
    `);
    await this.enableRls(queryRunner, 'affaire_version');

    await queryRunner.query(`
      CREATE TABLE devis_line (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        affaire_version_id uuid NOT NULL REFERENCES affaire_version(id) ON DELETE CASCADE,
        parent_line_id     uuid NULL REFERENCES devis_line(id) ON DELETE CASCADE,
        type               varchar(16) NOT NULL
                             CHECK (type IN ('titre', 'sous_titre', 'ouvrage', 'ressource')),
        code               varchar(64) NULL,
        designation        varchar(500) NOT NULL,
        unit               varchar(16) NULL,
        quantity           numeric(16,4) NULL,
        quantity_formula   text NULL,
        pu                 numeric(14,4) NULL,
        source_ouvrage_id  uuid NULL REFERENCES ouvrage(id) ON DELETE SET NULL,
        source_resource_id uuid NULL REFERENCES resource(id) ON DELETE SET NULL,
        sort_order         integer NOT NULL DEFAULT 0,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_devis_line_version ON devis_line(affaire_version_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_devis_line_parent ON devis_line(parent_line_id);`,
    );
    await this.enableRls(queryRunner, 'devis_line');

    await queryRunner.query(`
      CREATE TABLE metre_variable (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        affaire_version_id uuid NOT NULL REFERENCES affaire_version(id) ON DELETE CASCADE,
        name               varchar(64) NOT NULL,
        value              numeric(16,4) NOT NULL DEFAULT 0,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        UNIQUE (affaire_version_id, name)
      );
    `);
    await this.enableRls(queryRunner, 'metre_variable');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS metre_variable;`);
    await queryRunner.query(`DROP TABLE IF EXISTS devis_line;`);
    await queryRunner.query(`DROP TABLE IF EXISTS affaire_version;`);
    await queryRunner.query(`DROP TABLE IF EXISTS affaire;`);
  }
}
