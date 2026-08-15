import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fonction de la personne dans l'entreprise (gérant, conducteur de travaux, deviseur…).
 *
 * Renseignée à l'inscription par le créateur du compte, elle sert à savoir À QUI l'on parle —
 * une information que l'éditeur et les éditions (devis, courriers) réclament, et qu'il fallait
 * jusqu'ici deviner. Facultative : un compte reste valable sans.
 */
export class UserJobTitle1748000000090 implements MigrationInterface {
  name = 'UserJobTitle1748000000090';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_account ADD COLUMN job_title varchar(128) NULL;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_account DROP COLUMN IF EXISTS job_title;`);
  }
}
