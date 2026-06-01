import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RLS helper: current_tenant() reads the transaction-local GUC `app.current_tenant`
 * set by runInTenant(). Returns NULL when unset, so a query without a tenant context
 * matches no rows on RLS-protected tables (safe default).
 */
export class CreateRlsHelper1748000000001 implements MigrationInterface {
  name = 'CreateRlsHelper1748000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION current_tenant() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid;
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS current_tenant();`);
  }
}
