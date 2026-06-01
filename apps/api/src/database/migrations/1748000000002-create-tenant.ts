import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Root tenant table. It is the anchor of multi-tenancy and therefore carries no tenant_id
 * and no RLS — every other tenant-scoped table references it.
 */
export class CreateTenant1748000000002 implements MigrationInterface {
  name = 'CreateTenant1748000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug        varchar(63) NOT NULL UNIQUE,
        name        varchar(255) NOT NULL,
        status      varchar(32) NOT NULL DEFAULT 'active',
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tenant;`);
  }
}
