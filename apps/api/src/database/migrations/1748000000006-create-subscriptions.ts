import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Subscription lifecycle (cahier des charges §3.4). One subscription per tenant, aggregating
 * per-module lines. These are the source of truth; SubscriptionService projects them onto the
 * enforcement tables (tenant_module / tenant_quota) read by the capability guard.
 * Both tables are tenant-scoped (RLS: ENABLE + FORCE + current_tenant policy).
 */
export class CreateSubscriptions1748000000006 implements MigrationInterface {
  name = 'CreateSubscriptions1748000000006';

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
      CREATE TABLE subscription (
        id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id                uuid NOT NULL UNIQUE REFERENCES tenant(id) ON DELETE CASCADE,
        status                   varchar(32) NOT NULL,
        trial_ends_at            timestamptz NULL,
        current_period_end       timestamptz NULL,
        cancel_at_period_end     boolean NOT NULL DEFAULT false,
        provider_customer_id     varchar(255) NULL,
        provider_subscription_id varchar(255) NULL,
        created_at               timestamptz NOT NULL DEFAULT now(),
        updated_at               timestamptz NOT NULL DEFAULT now()
      );
    `);
    await this.enableRls(queryRunner, 'subscription');

    await queryRunner.query(`
      CREATE TABLE module_subscription (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        subscription_id  uuid NOT NULL REFERENCES subscription(id) ON DELETE CASCADE,
        module_code      varchar(64) NOT NULL REFERENCES module(code),
        seats_purchased  integer NOT NULL DEFAULT 0,
        billing_period   varchar(16) NOT NULL DEFAULT 'monthly',
        unit_price       numeric(10,2) NULL,
        period_start     timestamptz NULL,
        period_end       timestamptz NULL,
        read_only        boolean NOT NULL DEFAULT false,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        UNIQUE (subscription_id, module_code)
      );
    `);
    await this.enableRls(queryRunner, 'module_subscription');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS module_subscription;`);
    await queryRunner.query(`DROP TABLE IF EXISTS subscription;`);
  }
}
