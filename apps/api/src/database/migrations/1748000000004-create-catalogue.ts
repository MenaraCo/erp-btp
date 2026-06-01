import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Commercial catalogue: modules, capabilities, their mapping, packs and quota definitions.
 * These are GLOBAL configuration tables (no tenant_id, no RLS) — shared across all tenants
 * and seeded from src/core/catalog/catalog.config.ts.
 */
export class CreateCatalogue1748000000004 implements MigrationInterface {
  name = 'CreateCatalogue1748000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE capability (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key         varchar(64) NOT NULL UNIQUE,
        label       varchar(255) NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE module (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code        varchar(64) NOT NULL UNIQUE,
        label       varchar(255) NOT NULL,
        is_addon    boolean NOT NULL DEFAULT false,
        active      boolean NOT NULL DEFAULT true,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE module_capability (
        module_id      uuid NOT NULL REFERENCES module(id) ON DELETE CASCADE,
        capability_id  uuid NOT NULL REFERENCES capability(id) ON DELETE CASCADE,
        PRIMARY KEY (module_id, capability_id)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE pack (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code          varchar(64) NOT NULL UNIQUE,
        label         varchar(255) NOT NULL,
        discount_pct  numeric(5,2) NOT NULL DEFAULT 0,
        active        boolean NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE pack_module (
        pack_id    uuid NOT NULL REFERENCES pack(id) ON DELETE CASCADE,
        module_id  uuid NOT NULL REFERENCES module(id) ON DELETE CASCADE,
        PRIMARY KEY (pack_id, module_id)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE quota_definition (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key         varchar(64) NOT NULL UNIQUE,
        label       varchar(255) NOT NULL,
        unit        varchar(32) NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS quota_definition;`);
    await queryRunner.query(`DROP TABLE IF EXISTS pack_module;`);
    await queryRunner.query(`DROP TABLE IF EXISTS pack;`);
    await queryRunner.query(`DROP TABLE IF EXISTS module_capability;`);
    await queryRunner.query(`DROP TABLE IF EXISTS module;`);
    await queryRunner.query(`DROP TABLE IF EXISTS capability;`);
  }
}
