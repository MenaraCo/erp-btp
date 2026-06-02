import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * E-invoicing record (compliance, cahier des charges §7): tracks the Factur-X / e-invoicing
 * lifecycle of an invoice, separate from the invoice itself (clean isolation of fiscal concerns).
 * Tenant-scoped (RLS).
 */
export class CreateEinvoice1748000000019 implements MigrationInterface {
  name = 'CreateEinvoice1748000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE einvoice (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id           uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        invoice_id          uuid NOT NULL UNIQUE REFERENCES invoice(id) ON DELETE CASCADE,
        status              varchar(32) NOT NULL DEFAULT 'issued',
        cii_profile         varchar(128) NOT NULL,
        compliance_version  varchar(32) NOT NULL,
        chorus_pro_ref      varchar(64) NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`ALTER TABLE einvoice ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE einvoice FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY einvoice_tenant_isolation ON einvoice
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS einvoice;`);
  }
}
