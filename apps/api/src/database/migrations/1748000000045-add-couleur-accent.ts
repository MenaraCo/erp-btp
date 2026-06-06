import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ajout de la couleur d'accent paramétrable (boutons, codes, badges actifs).
 * Jusqu'ici hardcodée à #e8550a dans globals.css.
 */
export class AddCouleurAccent1748000000045 implements MigrationInterface {
  name = 'AddCouleurAccent1748000000045';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE company_preferences
         ADD COLUMN IF NOT EXISTS couleur_accent varchar(16) NOT NULL DEFAULT '#e8550a';`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE company_preferences DROP COLUMN IF EXISTS couleur_accent;`,
    );
  }
}
