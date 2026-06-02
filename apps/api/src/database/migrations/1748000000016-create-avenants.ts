import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Avenants (cahier des charges §5.4, rule #4): amendments to a marché. Avenant lines are stored
 * in marche_line tagged with avenant_id (NULL = initial marché) and recodified with a -AVn
 * suffix, so situations naturally cover marché + avenants. Tenant-scoped (RLS).
 */
export class CreateAvenants1748000000016 implements MigrationInterface {
  name = 'CreateAvenants1748000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE avenant (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        marche_id   uuid NOT NULL REFERENCES marche(id) ON DELETE CASCADE,
        numero      integer NOT NULL,
        label       varchar(255) NULL,
        status      varchar(32) NOT NULL DEFAULT 'active',
        total_ht    numeric(16,2) NOT NULL DEFAULT 0,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (marche_id, numero)
      );
    `);
    await queryRunner.query(`ALTER TABLE avenant ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE avenant FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY avenant_tenant_isolation ON avenant
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);

    await queryRunner.query(
      `ALTER TABLE marche_line ADD COLUMN avenant_id uuid NULL REFERENCES avenant(id) ON DELETE CASCADE;`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_marche_line_avenant ON marche_line(avenant_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE marche_line DROP COLUMN IF EXISTS avenant_id;`);
    await queryRunner.query(`DROP TABLE IF EXISTS avenant;`);
  }
}
