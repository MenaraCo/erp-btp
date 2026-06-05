import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sous-détail copié & modifiable (M.4) : quand un ouvrage de bibliothèque est posé dans un devis,
 * ses composants sont copiés en lignes ressource enfants éditables (ratio/quantité, perte, PU)
 * découplées de la bibliothèque. `perte` (% de perte sur la ressource) est ajouté sur devis_line.
 * Additif, réversible.
 */
export class DevisLinePerte1748000000039 implements MigrationInterface {
  name = 'DevisLinePerte1748000000039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE devis_line ADD COLUMN perte numeric(7,2) NOT NULL DEFAULT 0;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE devis_line DROP COLUMN IF EXISTS perte;`);
  }
}
