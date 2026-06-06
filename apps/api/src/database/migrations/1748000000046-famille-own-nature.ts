import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrige le modèle analytique : la nature appartient à la famille, pas au lot.
 *
 * Avant : analytical_lot.nature (lot = Sols durs, Peinture…)
 * Après : analytical_famille.nature (famille = Colles, Enduits, Joints…)
 *
 * Backfill : chaque famille hérite la nature de son lot parent pour préserver
 * les données existantes.
 */
export class FamilleOwnNature1748000000046 implements MigrationInterface {
  name = 'FamilleOwnNature1748000000046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Ajout de la colonne nullable d'abord pour le backfill
    await queryRunner.query(`
      ALTER TABLE analytical_famille
        ADD COLUMN IF NOT EXISTS nature varchar(16) NULL
          CHECK (nature IN ('material','equipment','subcontract','labor'));
    `);

    // Backfill depuis le lot parent
    await queryRunner.query(`
      UPDATE analytical_famille f
      SET nature = l.nature
      FROM analytical_lot l
      WHERE l.id = f.lot_id AND f.nature IS NULL;
    `);

    // Passe NOT NULL avec défaut pour les éventuelles lignes sans lot valide
    await queryRunner.query(`
      UPDATE analytical_famille SET nature = 'material' WHERE nature IS NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE analytical_famille ALTER COLUMN nature SET NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE analytical_famille DROP COLUMN IF EXISTS nature;
    `);
  }
}
