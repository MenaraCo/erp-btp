import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Structure hiérarchique des lignes de marché (cahier des charges §5.6).
 *
 * Jusqu'ici `marche_line` était une liste PLATE d'ouvrages facturables. Pour que la situation de
 * travaux ait la MÊME structure que le devis (titres → ouvrages) et qu'on avance ligne par ligne,
 * la ligne de marché porte désormais un `parent_line_id` (auto-référence) et un `type`
 * (titre = poste structurel sans montant propre / ouvrage = ligne facturable).
 *
 * Reprise NON destructive : les lignes existantes deviennent des ouvrages de premier niveau
 * (parent NULL, type 'ouvrage'). Réversible.
 */
export class MarcheLineTree1748000000060 implements MigrationInterface {
  name = 'MarcheLineTree1748000000060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE marche_line
        ADD COLUMN parent_line_id uuid NULL REFERENCES marche_line(id) ON DELETE CASCADE,
        ADD COLUMN type varchar(16) NOT NULL DEFAULT 'ouvrage'
          CHECK (type IN ('titre', 'ouvrage'));
    `);
    await queryRunner.query(`CREATE INDEX idx_marche_line_parent ON marche_line(parent_line_id);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_marche_line_parent;`);
    await queryRunner.query(`
      ALTER TABLE marche_line
        DROP COLUMN IF EXISTS parent_line_id,
        DROP COLUMN IF EXISTS type;
    `);
  }
}
