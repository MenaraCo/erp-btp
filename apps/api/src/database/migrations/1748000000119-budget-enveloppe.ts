import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * L'ENVELOPPE : on ne crée pas d'argent en cours de chantier.
 *
 * Le budget d'un chantier n'est pas un compte sans fond. Il vient de ce qui a été vendu ; il se
 * REDISTRIBUE (ripage, à somme nulle) et il n'AUGMENTE que pour une raison nommée : un avenant
 * signé, qui apporte à la fois du travail en plus et la recette qui va avec. Sans cette règle, une
 * dotation isolée gonfle l'enveloppe sans contrepartie, l'écart au budget s'efface tout seul, et
 * le tableau de bord finit par certifier que tout va bien.
 *
 * Deux échappatoires, toutes deux explicites et tracées :
 *  - rattacher la ligne à un AVENANT (l'argent vient de là) ;
 *  - assumer un DÉPASSEMENT, motivé — un dérapage décidé reste enregistrable, mais il se voit.
 */
export class BudgetEnveloppe1748000000119 implements MigrationInterface {
  name = 'BudgetEnveloppe1748000000119';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE chantier_budget_movement
        ADD COLUMN avenant_id uuid NULL REFERENCES avenant(id) ON DELETE SET NULL,
        /* Augmentation d'enveloppe assumée : elle passe, mais elle porte son nom. */
        ADD COLUMN depassement_assume boolean NOT NULL DEFAULT false;
    `);
    await queryRunner.query(
      `CREATE INDEX idx_budget_movement_avenant ON chantier_budget_movement(avenant_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE chantier_budget_movement
        DROP COLUMN IF EXISTS avenant_id,
        DROP COLUMN IF EXISTS depassement_assume;
    `);
  }
}
