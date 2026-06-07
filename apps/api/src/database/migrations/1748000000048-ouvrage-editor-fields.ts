import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Champs pour l'éditeur d'ouvrage dédié (composition riche, cahier §5.1) :
 *  - ouvrage : description, categorie, lot_id (rattachement optionnel à un lot du plan analytique)
 *  - ouvrage_component : perte (% de perte appliqué au ratio dans le calcul du déboursé)
 *
 * Additif et non destructif.
 */
export class OuvrageEditorFields1748000000048 implements MigrationInterface {
  name = 'OuvrageEditorFields1748000000048';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ouvrage ADD COLUMN IF NOT EXISTS description text NULL;`);
    await queryRunner.query(`ALTER TABLE ouvrage ADD COLUMN IF NOT EXISTS categorie varchar(128) NULL;`);
    await queryRunner.query(
      `ALTER TABLE ouvrage ADD COLUMN IF NOT EXISTS lot_id uuid NULL REFERENCES analytical_lot(id) ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE ouvrage_component ADD COLUMN IF NOT EXISTS perte numeric(9,4) NOT NULL DEFAULT 0;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ouvrage_component DROP COLUMN IF EXISTS perte;`);
    await queryRunner.query(`ALTER TABLE ouvrage DROP COLUMN IF EXISTS lot_id;`);
    await queryRunner.query(`ALTER TABLE ouvrage DROP COLUMN IF EXISTS categorie;`);
    await queryRunner.query(`ALTER TABLE ouvrage DROP COLUMN IF EXISTS description;`);
  }
}
