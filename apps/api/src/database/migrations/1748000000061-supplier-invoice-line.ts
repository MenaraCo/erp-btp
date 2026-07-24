import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Imputation d'une facture fournisseur à un OUVRAGE (cahier des charges §5.8, axe structurel).
 *
 * `purchase_order_line` (engagé) et `timesheet` (réalisé MO) portent déjà `execution_line_id` ;
 * la facture fournisseur (réalisé achats) ne l'avait pas. On l'ajoute (optionnel) pour pouvoir
 * comparer, ouvrage par ouvrage, le budget avancé au réalisé + engagé — l'écart au stade par
 * ouvrage. Non destructif (lignes existantes = non imputées, "Non réparti"), réversible.
 */
export class SupplierInvoiceLine1748000000061 implements MigrationInterface {
  name = 'SupplierInvoiceLine1748000000061';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE supplier_invoice
        ADD COLUMN execution_line_id uuid NULL REFERENCES execution_line(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(
      `CREATE INDEX idx_supplier_invoice_exec_line ON supplier_invoice(execution_line_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_supplier_invoice_exec_line;`);
    await queryRunner.query(`ALTER TABLE supplier_invoice DROP COLUMN IF EXISTS execution_line_id;`);
  }
}
