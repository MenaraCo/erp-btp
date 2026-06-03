import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Imputation analytique de l'engagé et du réalisé (cahier des charges §5.8) — increment B.0d.
 *
 * For the differentiating cost-control engine to compare budget / engagé / réalisé at EVERY
 * level of the analytical axis (not just nature), the cost-bearing lines must carry the famille
 * (→ lot → nature) — the same analytical code as the resource. Adds a nullable famille FK to
 * purchase_order_line (engagé) and supplier_invoice (réalisé).
 *
 * Nullable + no backfill: existing rows keep `nature` only and aggregate into the per-nature
 * "Non réparti" bucket until reclassified. Non-destructive.
 */
export class ImputeEngageRealiseFamille1748000000028 implements MigrationInterface {
  name = 'ImputeEngageRealiseFamille1748000000028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_order_line
        ADD COLUMN famille_analytique_id uuid NULL
          REFERENCES analytical_famille(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(
      `CREATE INDEX idx_po_line_famille ON purchase_order_line(famille_analytique_id);`,
    );
    await queryRunner.query(`
      ALTER TABLE supplier_invoice
        ADD COLUMN famille_analytique_id uuid NULL
          REFERENCES analytical_famille(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(
      `CREATE INDEX idx_supplier_invoice_famille ON supplier_invoice(famille_analytique_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_supplier_invoice_famille;`);
    await queryRunner.query(
      `ALTER TABLE supplier_invoice DROP COLUMN IF EXISTS famille_analytique_id;`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_po_line_famille;`);
    await queryRunner.query(
      `ALTER TABLE purchase_order_line DROP COLUMN IF EXISTS famille_analytique_id;`,
    );
  }
}
