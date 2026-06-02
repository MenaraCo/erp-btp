import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chaîne des achats (cahier des charges §5.5) — increment 3.5.
 * Demande de prix (DDP) → Bon de commande (BC) → Bon de livraison (BL) → Facture fournisseur.
 * ENGAGÉ = validated BC lines (by nature); RÉALISÉ achats = supplier invoices (by nature).
 * Stock reservation/valuation is Phase 4. Tenant-scoped (RLS).
 */
export class CreatePurchasing1748000000024 implements MigrationInterface {
  name = 'CreatePurchasing1748000000024';

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
      CREATE TABLE purchase_request (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id  uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        supplier_id  uuid NULL REFERENCES supplier(id) ON DELETE SET NULL,
        code         varchar(64) NOT NULL,
        status       varchar(16) NOT NULL DEFAULT 'open',
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      );
    `);
    await this.enableRls(queryRunner, 'purchase_request');

    await queryRunner.query(`
      CREATE TABLE purchase_order (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id  uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        request_id   uuid NULL REFERENCES purchase_request(id) ON DELETE SET NULL,
        supplier_id  uuid NULL REFERENCES supplier(id) ON DELETE SET NULL,
        code         varchar(64) NOT NULL,
        status       varchar(16) NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','validated','cancelled')),
        total_ht     numeric(16,2) NOT NULL DEFAULT 0,
        validated_at timestamptz NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_po_chantier ON purchase_order(chantier_id);`);
    await this.enableRls(queryRunner, 'purchase_order');

    await queryRunner.query(`
      CREATE TABLE purchase_order_line (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        order_id          uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
        execution_line_id uuid NULL REFERENCES execution_line(id) ON DELETE SET NULL,
        nature            varchar(16) NOT NULL
                            CHECK (nature IN ('labor','material','equipment','subcontract','site_overhead')),
        designation       varchar(500) NOT NULL,
        quantity          numeric(16,4) NOT NULL DEFAULT 0,
        unit_price        numeric(14,4) NOT NULL DEFAULT 0,
        amount_ht         numeric(16,2) NOT NULL DEFAULT 0,
        created_at        timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_po_line_order ON purchase_order_line(order_id);`);
    await this.enableRls(queryRunner, 'purchase_order_line');

    await queryRunner.query(`
      CREATE TABLE delivery_note (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        order_id     uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
        code         varchar(64) NOT NULL,
        received_at  date NOT NULL DEFAULT now(),
        created_at   timestamptz NOT NULL DEFAULT now()
      );
    `);
    await this.enableRls(queryRunner, 'delivery_note');

    await queryRunner.query(`
      CREATE TABLE supplier_invoice (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id  uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        order_id     uuid NULL REFERENCES purchase_order(id) ON DELETE SET NULL,
        code         varchar(64) NOT NULL,
        nature       varchar(16) NOT NULL
                       CHECK (nature IN ('labor','material','equipment','subcontract','site_overhead')),
        amount_ht    numeric(16,2) NOT NULL DEFAULT 0,
        invoice_date date NOT NULL DEFAULT now(),
        created_at   timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_supplier_invoice_chantier ON supplier_invoice(chantier_id);`);
    await this.enableRls(queryRunner, 'supplier_invoice');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS supplier_invoice;`);
    await queryRunner.query(`DROP TABLE IF EXISTS delivery_note;`);
    await queryRunner.query(`DROP TABLE IF EXISTS purchase_order_line;`);
    await queryRunner.query(`DROP TABLE IF EXISTS purchase_order;`);
    await queryRunner.query(`DROP TABLE IF EXISTS purchase_request;`);
  }
}
