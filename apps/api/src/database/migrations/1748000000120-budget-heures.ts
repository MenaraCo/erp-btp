import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Le BUDGET D'HEURES : un conducteur de travaux raisonne en heures, pas en euros.
 *
 * « Il me reste combien d'heures de maçon ? » n'a pas de réponse dans un tableau d'euros : un taux
 * horaire qui change, et le même euro ne vaut plus le même temps. Le guide (§13.1) résout cela par
 * une case sur l'A.R.C. : « les quantités de ce poste entrent dans le décompte des heures de
 * production ». On la porte telle quelle sur le code analytique.
 *
 * Les postes de main-d'œuvre existants la reçoivent d'office — c'est ce que la société attend d'un
 * plan analytique déjà rempli — et elle reste décochable.
 */
export class BudgetHeures1748000000120 implements MigrationInterface {
  name = 'BudgetHeures1748000000120';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE analytical_code
        ADD COLUMN heures_production boolean NOT NULL DEFAULT false;
    `);
    await queryRunner.query(`
      UPDATE analytical_code c SET heures_production = true
        FROM analytical_famille f
        LEFT JOIN analytical_lot l ON l.id = f.lot_id
       WHERE f.id = c.famille_id
         AND COALESCE(c.nature, f.nature, l.nature) = 'labor'
         AND COALESCE(c.categorie, 'charge') = 'charge';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE analytical_code DROP COLUMN IF EXISTS heures_production;`);
  }
}
