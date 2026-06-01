import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Base directory of the socle: clients and suppliers. Tenant-scoped (RLS: ENABLE + FORCE +
 * current_tenant policy), with a JSONB address for variable attributes and soft delete.
 */
export class CreateDirectory1748000000009 implements MigrationInterface {
  name = 'CreateDirectory1748000000009';

  private async createParty(qr: QueryRunner, table: string): Promise<void> {
    await qr.query(`
      CREATE TABLE ${table} (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        code        varchar(64) NOT NULL,
        name        varchar(255) NOT NULL,
        vat_number  varchar(32) NULL,
        email       varchar(320) NULL,
        phone       varchar(32) NULL,
        address     jsonb NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz NULL,
        UNIQUE (tenant_id, code)
      );
    `);
    await qr.query(`CREATE INDEX idx_${table}_tenant ON ${table}(tenant_id);`);
    await qr.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    await qr.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    await qr.query(`
      CREATE POLICY ${table}_tenant_isolation ON ${table}
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createParty(queryRunner, 'client');
    await this.createParty(queryRunner, 'supplier');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS supplier;`);
    await queryRunner.query(`DROP TABLE IF EXISTS client;`);
  }
}
