import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Imputation analytique des éléments variables de paye.
 *
 * Une dépense qui n'est rattachée à aucun code analytique n'apparaît nulle part dans les tableaux
 * de bord : elle disparaît du résultat du chantier alors qu'elle a bien été payée. Paniers,
 * déplacements et primes se comptent en milliers d'euros sur une année — les laisser hors de
 * l'analytique, c'est afficher une marge fausse.
 *
 * La rubrique porte le code par défaut (les paniers vont toujours au même poste) ; la ligne peut
 * le remplacer, parce qu'une prime exceptionnelle n'appartient pas forcément au même poste que la
 * rubrique qui la porte.
 */
export class PayeCodeAnalytique1748000000109 implements MigrationInterface {
  name = 'PayeCodeAnalytique1748000000109';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payroll_rubrique
        ADD COLUMN code_analytique_id uuid NULL REFERENCES analytical_code(id) ON DELETE SET NULL,
        /* Nature analytique de la dépense : un panier est de la main-d'œuvre, pas un matériau. */
        ADD COLUMN nature varchar(16) NOT NULL DEFAULT 'labor'
          CHECK (nature IN ('labor', 'material', 'equipment', 'subcontract', 'site_overhead'));
    `);
    await queryRunner.query(`
      ALTER TABLE payroll_line
        ADD COLUMN code_analytique_id uuid NULL REFERENCES analytical_code(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(
      `CREATE INDEX idx_payroll_line_code_analytique ON payroll_line(code_analytique_id);`,
    );

    // Reprise : les lignes déjà calculées prennent le code de leur rubrique (souvent vide encore).
    await queryRunner.query(`
      UPDATE payroll_line l
         SET code_analytique_id = r.code_analytique_id
        FROM payroll_rubrique r
       WHERE r.id = l.rubrique_id AND l.code_analytique_id IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_payroll_line_code_analytique;`);
    await queryRunner.query(`ALTER TABLE payroll_line DROP COLUMN IF EXISTS code_analytique_id;`);
    await queryRunner.query(`
      ALTER TABLE payroll_rubrique
        DROP COLUMN IF EXISTS code_analytique_id,
        DROP COLUMN IF EXISTS nature;
    `);
  }
}
