import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Imputation au code analytique (cahier des charges §5.8 + §5.5) — refactor C.2 (schéma).
 *
 * La nomenclature de chantier porte SON PROPRE code analytique (copié au transfert depuis la
 * ressource d'étude), pour couper toute lecture live vers la bibliothèque d'étude (les deux
 * catalogues évoluent indépendamment). Les lignes de coût (engagé/réalisé/pointage) reçoivent une
 * imputation optionnelle à un code analytique du plan partagé.
 *
 * Additif et non destructif : colonnes NULLABLE, famille_analytique_id conservé transitoirement.
 */
export class ImputeCodeAnalytique1748000000032 implements MigrationInterface {
  name = 'ImputeCodeAnalytique1748000000032';

  private async addCodeAnalytique(qr: QueryRunner, table: string): Promise<void> {
    await qr.query(
      `ALTER TABLE ${table} ADD COLUMN code_analytique_id uuid NULL
         REFERENCES analytical_code(id) ON DELETE SET NULL;`,
    );
    await qr.query(`CREATE INDEX idx_${table}_code_analytique ON ${table}(code_analytique_id);`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nomenclature de chantier : son propre rattachement analytique (copié au transfert).
    await this.addCodeAnalytique(queryRunner, 'nomenclature_resource');
    // Lignes de coût : imputation analytique optionnelle.
    await this.addCodeAnalytique(queryRunner, 'purchase_order_line');
    await this.addCodeAnalytique(queryRunner, 'supplier_invoice');
    await this.addCodeAnalytique(queryRunner, 'timesheet');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['timesheet', 'supplier_invoice', 'purchase_order_line', 'nomenclature_resource']) {
      await queryRunner.query(`DROP INDEX IF EXISTS idx_${table}_code_analytique;`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS code_analytique_id;`);
    }
  }
}
