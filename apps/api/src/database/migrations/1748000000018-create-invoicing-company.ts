import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Minimal société + invoice numbering chrono + invoices (cahier des charges §5.6).
 * The chrono "montage" (pattern) is configured once per company and frozen (locked) as soon as
 * the first invoice is issued. Invoices are generated from a situation. Tenant-scoped (RLS).
 */
export class CreateInvoicingCompany1748000000018 implements MigrationInterface {
  name = 'CreateInvoicingCompany1748000000018';

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
      CREATE TABLE company (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        code        varchar(64) NOT NULL,
        name        varchar(255) NOT NULL,
        siren       varchar(14) NULL,
        vat_number  varchar(32) NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, code)
      );
    `);
    await this.enableRls(queryRunner, 'company');

    await queryRunner.query(`
      CREATE TABLE invoice_chrono (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        company_id  uuid NOT NULL UNIQUE REFERENCES company(id) ON DELETE CASCADE,
        pattern     varchar(64) NOT NULL,
        next_seq    integer NOT NULL DEFAULT 1,
        locked      boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `);
    await this.enableRls(queryRunner, 'invoice_chrono');

    await queryRunner.query(`
      CREATE TABLE invoice (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        company_id    uuid NOT NULL REFERENCES company(id) ON DELETE RESTRICT,
        situation_id  uuid NOT NULL REFERENCES situation(id) ON DELETE RESTRICT,
        numero        varchar(64) NOT NULL,
        date          date NOT NULL DEFAULT now(),
        status        varchar(32) NOT NULL DEFAULT 'issued',
        montant_ht    numeric(16,2) NOT NULL DEFAULT 0,
        tva           numeric(16,2) NOT NULL DEFAULT 0,
        tpf           numeric(16,2) NOT NULL DEFAULT 0,
        ttc           numeric(16,2) NOT NULL DEFAULT 0,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, numero),
        UNIQUE (tenant_id, situation_id)
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_invoice_company ON invoice(company_id);`);
    await this.enableRls(queryRunner, 'invoice');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS invoice;`);
    await queryRunner.query(`DROP TABLE IF EXISTS invoice_chrono;`);
    await queryRunner.query(`DROP TABLE IF EXISTS company;`);
  }
}
