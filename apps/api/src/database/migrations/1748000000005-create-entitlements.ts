import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enforcement tables for the capability guard, jetons (seats) and quotas.
 * All are tenant-scoped (RLS: ENABLE + FORCE + policy on current_tenant()).
 *
 * These are populated by hand/tests for now; phase 0.5 (subscriptions) will drive
 * tenant_module / tenant_quota from the billing provider. The guard reads them regardless
 * of how they are populated, so its contract stays stable.
 */
export class CreateEntitlements1748000000005 implements MigrationInterface {
  name = 'CreateEntitlements1748000000005';

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
    // Minimal user identity (full auth fields land in phase 0.7).
    await queryRunner.query(`
      CREATE TABLE user_account (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        email       varchar(320) NOT NULL,
        full_name   varchar(255),
        status      varchar(32) NOT NULL DEFAULT 'active',
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz NULL,
        UNIQUE (tenant_id, email)
      );
    `);
    await this.enableRls(queryRunner, 'user_account');

    // A module activated for a tenant, with the number of purchased seats (jetons).
    await queryRunner.query(`
      CREATE TABLE tenant_module (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        module_code      varchar(64) NOT NULL REFERENCES module(code),
        seats_purchased  integer NOT NULL DEFAULT 0,
        active           boolean NOT NULL DEFAULT true,
        read_only        boolean NOT NULL DEFAULT false,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, module_code)
      );
    `);
    await this.enableRls(queryRunner, 'tenant_module');

    // A jeton: assignment of one module seat to one user. Count per module <= seats_purchased.
    await queryRunner.query(`
      CREATE TABLE seat_assignment (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        module_code  varchar(64) NOT NULL REFERENCES module(code),
        user_id      uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
        assigned_at  timestamptz NOT NULL DEFAULT now(),
        assigned_by  uuid NULL,
        UNIQUE (tenant_id, module_code, user_id)
      );
    `);
    await this.enableRls(queryRunner, 'seat_assignment');

    // Per-tenant quota limits (populated from subscriptions in 0.5).
    await queryRunner.query(`
      CREATE TABLE tenant_quota (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        metric_key   varchar(64) NOT NULL REFERENCES quota_definition(key),
        limit_value  bigint NOT NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, metric_key)
      );
    `);
    await this.enableRls(queryRunner, 'tenant_quota');

    // Current usage per metric, compared to tenant_quota before creation actions.
    await queryRunner.query(`
      CREATE TABLE usage_counter (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        metric_key     varchar(64) NOT NULL REFERENCES quota_definition(key),
        current_value  bigint NOT NULL DEFAULT 0,
        updated_at     timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, metric_key)
      );
    `);
    await this.enableRls(queryRunner, 'usage_counter');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS usage_counter;`);
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_quota;`);
    await queryRunner.query(`DROP TABLE IF EXISTS seat_assignment;`);
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_module;`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_account;`);
  }
}
