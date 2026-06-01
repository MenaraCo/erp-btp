import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Disposable table used solely to prove tenant isolation in phase 0.2.
 * It is the reference template for every future tenant-scoped table:
 *   ENABLE + FORCE ROW LEVEL SECURITY, and a USING/WITH CHECK policy on current_tenant().
 * FORCE makes the policy apply even to the table owner (the dev/embedded connection),
 * so the isolation tests are meaningful locally. In production a dedicated non-privileged
 * application role (no BYPASSRLS) provides an additional layer.
 * This table will be dropped by a later migration once real domain tables exist.
 */
export class CreateDemoRecordWithRls1748000000003 implements MigrationInterface {
  name = 'CreateDemoRecordWithRls1748000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE demo_record (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        label       varchar(255) NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz NULL
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_demo_record_tenant ON demo_record(tenant_id);`,
    );
    await queryRunner.query(
      `ALTER TABLE demo_record ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`ALTER TABLE demo_record FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY demo_record_tenant_isolation ON demo_record
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS demo_record;`);
  }
}
