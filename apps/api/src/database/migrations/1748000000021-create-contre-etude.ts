import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Contre-étude (cahier des charges §5.5) — increment 3.2. Adds the chantier nomenclature
 * (resources with frozen étude price vs negotiated objectif price) and the execution components
 * (déboursé sub-detail), plus a `vendable` flag on execution lines. The works renegotiate PU
 * (nomenclature objectif) and quantities (component objectif); the objectif budget is recomputed
 * by the pure engine. Tenant-scoped (RLS).
 */
export class CreateContreEtude1748000000021 implements MigrationInterface {
  name = 'CreateContreEtude1748000000021';

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
    await queryRunner.query(
      `ALTER TABLE execution_line ADD COLUMN vendable boolean NOT NULL DEFAULT true;`,
    );

    await queryRunner.query(`
      CREATE TABLE nomenclature_resource (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id        uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        source_resource_id uuid NULL,
        code               varchar(64) NOT NULL,
        label              varchar(255) NOT NULL,
        unit               varchar(16) NULL,
        nature             varchar(16) NOT NULL
                             CHECK (nature IN ('labor','material','equipment','subcontract')),
        unit_cost_etude    numeric(14,4) NOT NULL DEFAULT 0,
        unit_cost_objectif numeric(14,4) NOT NULL DEFAULT 0,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        UNIQUE (chantier_id, code)
      );
    `);
    await this.enableRls(queryRunner, 'nomenclature_resource');

    await queryRunner.query(`
      CREATE TABLE execution_component (
        id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id                uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        execution_line_id        uuid NOT NULL REFERENCES execution_line(id) ON DELETE CASCADE,
        kind                     varchar(16) NOT NULL
                                   CHECK (kind IN ('resource', 'sub_line', 'percentage')),
        nomenclature_resource_id uuid NULL REFERENCES nomenclature_resource(id) ON DELETE CASCADE,
        child_line_id            uuid NULL REFERENCES execution_line(id) ON DELETE CASCADE,
        quantite_etude           numeric(14,4) NULL,
        quantite_objectif        numeric(14,4) NULL,
        rate                     numeric(9,6) NULL,
        sort_order               integer NOT NULL DEFAULT 0,
        created_at               timestamptz NOT NULL DEFAULT now(),
        updated_at               timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_execution_component_line ON execution_component(execution_line_id);`,
    );
    await this.enableRls(queryRunner, 'execution_component');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS execution_component;`);
    await queryRunner.query(`DROP TABLE IF EXISTS nomenclature_resource;`);
    await queryRunner.query(`ALTER TABLE execution_line DROP COLUMN IF EXISTS vendable;`);
  }
}
