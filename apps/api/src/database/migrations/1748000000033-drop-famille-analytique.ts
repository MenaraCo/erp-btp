import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nettoyage du refactor « plan analytique à 5 niveaux » (cahier §5.8) — refactor C.4.
 *
 * Les services sont passés au code analytique (resource.code_analytique_id, et imputation des
 * lignes de coût au code analytique). La colonne intermédiaire `famille_analytique_id`
 * (modèle à 4 niveaux) devient vestigiale et est retirée de resource, purchase_order_line et
 * supplier_invoice. Réversible (recrée les colonnes nullables au down).
 */
export class DropFamilleAnalytique1748000000033 implements MigrationInterface {
  name = 'DropFamilleAnalytique1748000000033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_resource_famille;`);
    await queryRunner.query(`ALTER TABLE resource DROP COLUMN IF EXISTS famille_analytique_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_po_line_famille;`);
    await queryRunner.query(`ALTER TABLE purchase_order_line DROP COLUMN IF EXISTS famille_analytique_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_supplier_invoice_famille;`);
    await queryRunner.query(`ALTER TABLE supplier_invoice DROP COLUMN IF EXISTS famille_analytique_id;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE supplier_invoice ADD COLUMN famille_analytique_id uuid NULL REFERENCES analytical_famille(id) ON DELETE SET NULL;`,
    );
    await queryRunner.query(`CREATE INDEX idx_supplier_invoice_famille ON supplier_invoice(famille_analytique_id);`);
    await queryRunner.query(
      `ALTER TABLE purchase_order_line ADD COLUMN famille_analytique_id uuid NULL REFERENCES analytical_famille(id) ON DELETE SET NULL;`,
    );
    await queryRunner.query(`CREATE INDEX idx_po_line_famille ON purchase_order_line(famille_analytique_id);`);
    await queryRunner.query(
      `ALTER TABLE resource ADD COLUMN famille_analytique_id uuid NULL REFERENCES analytical_famille(id) ON DELETE SET NULL;`,
    );
    await queryRunner.query(`CREATE INDEX idx_resource_famille ON resource(famille_analytique_id);`);
  }
}
