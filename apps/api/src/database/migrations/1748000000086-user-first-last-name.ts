import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sépare le nom et le prénom du compte utilisateur.
 *
 * `full_name` tenait les deux dans une seule cellule (« Prénom Nom »), ce qui empêche de trier par
 * nom, d'harmoniser la saisie, ou d'afficher « Nom, Prénom ». On ajoute `first_name` / `last_name`
 * et on rétro-remplit en découpant l'existant au premier espace (convention FR : prénom puis nom).
 *
 * `full_name` est CONSERVÉ comme valeur d'affichage (recalculée « prénom nom » à chaque écriture),
 * pour que tous les écrans qui l'affichent déjà continuent de fonctionner sans changement.
 */
export class UserFirstLastName1748000000086 implements MigrationInterface {
  name = 'UserFirstLastName1748000000086';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_account ADD COLUMN first_name varchar(255) NULL;`);
    await queryRunner.query(`ALTER TABLE user_account ADD COLUMN last_name varchar(255) NULL;`);
    await queryRunner.query(`
      UPDATE user_account
         SET first_name = NULLIF(split_part(full_name, ' ', 1), ''),
             last_name = NULLIF(
               CASE WHEN strpos(full_name, ' ') > 0
                    THEN btrim(substr(full_name, strpos(full_name, ' ') + 1))
                    ELSE '' END, '')
       WHERE full_name IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_account DROP COLUMN IF EXISTS last_name;`);
    await queryRunner.query(`ALTER TABLE user_account DROP COLUMN IF EXISTS first_name;`);
  }
}
