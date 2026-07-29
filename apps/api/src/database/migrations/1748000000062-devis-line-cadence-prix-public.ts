import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Étude de prix — refonte du volet déboursé (inspiration fonctionnelle, présentation propre) :
 *  - `cadence` (rendement, ex. m²/h) sur le sous-détail : pour la main d'œuvre, le temps unitaire
 *    en découle (Tps = 1/cadence) et donc le déboursé MO ; colonne éditable comme le ratio.
 *  - `prix_public` sur la ligne de sous-détail : prix catalogue affiché en regard du déboursé
 *    (mention « conv » quand le déboursé est déduit du public via le coefficient de conversion).
 * Additif, nullable, réversible. `ouvrage_component.cadence` = même champ côté bibliothèque.
 */
export class DevisLineCadencePrixPublic1748000000062 implements MigrationInterface {
  name = 'DevisLineCadencePrixPublic1748000000062';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE devis_line
        ADD COLUMN cadence numeric(14,4) NULL,
        ADD COLUMN prix_public numeric(14,4) NULL;
    `);
    await queryRunner.query(
      `ALTER TABLE ouvrage_component ADD COLUMN IF NOT EXISTS cadence numeric(14,4) NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ouvrage_component DROP COLUMN IF EXISTS cadence;`);
    await queryRunner.query(`
      ALTER TABLE devis_line
        DROP COLUMN IF EXISTS prix_public,
        DROP COLUMN IF EXISTS cadence;
    `);
  }
}
