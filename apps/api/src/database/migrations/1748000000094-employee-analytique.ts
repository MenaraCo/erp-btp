import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Code analytique par défaut d'un salarié.
 *
 * Une heure pointée doit atterrir dans le bon poste des tableaux de gestion (MO maçonnerie, MO
 * finitions…). Jusqu'ici ce code se saisissait ligne par ligne — donc rarement, donc les heures
 * tombaient hors analytique et les résultats par code étaient faux.
 *
 * Le rattacher à la personne est le seul endroit où l'information est stable : un maçon impute
 * toujours sur le même poste. Le code reste forçable sur une ligne (un maçon prêté à un autre
 * poste pour une journée).
 */
export class EmployeeAnalytique1748000000094 implements MigrationInterface {
  name = 'EmployeeAnalytique1748000000094';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE employee ADD COLUMN code_analytique_id uuid NULL
         REFERENCES analytical_code(id) ON DELETE SET NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE employee DROP COLUMN IF EXISTS code_analytique_id;`);
  }
}
