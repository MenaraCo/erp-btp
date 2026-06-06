import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Paramètres : lots, familles et codes analytiques deviennent des référentiels
 * indépendants (code + label uniquement). Les rattachements hiérarchiques
 * (famille→lot, code→famille) et la nature seront définis dans la fiche ressource.
 *
 * On rend nullable : analytical_lot.nature, analytical_famille.lot_id,
 * analytical_famille.nature, analytical_code.famille_id.
 * Les FK sont conservées (intégrité) mais ne sont plus obligatoires.
 */
export class AnalyticalStandaloneRefs1748000000047 implements MigrationInterface {
  name = 'AnalyticalStandaloneRefs1748000000047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Lot : nature devient optionnelle
    await queryRunner.query(`
      ALTER TABLE analytical_lot ALTER COLUMN nature DROP NOT NULL;
    `);

    // Famille : lot_id devient optionnel (FK conservée, ON DELETE SET NULL)
    await queryRunner.query(`
      ALTER TABLE analytical_famille ALTER COLUMN lot_id DROP NOT NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE analytical_famille
        DROP CONSTRAINT IF EXISTS analytical_famille_lot_id_fkey;
    `);
    await queryRunner.query(`
      ALTER TABLE analytical_famille
        ADD CONSTRAINT analytical_famille_lot_id_fkey
          FOREIGN KEY (lot_id) REFERENCES analytical_lot(id) ON DELETE SET NULL;
    `);

    // Famille : nature devient optionnelle
    await queryRunner.query(`
      ALTER TABLE analytical_famille ALTER COLUMN nature DROP NOT NULL;
    `);

    // Code analytique : famille_id devient optionnel (FK conservée, ON DELETE SET NULL)
    await queryRunner.query(`
      ALTER TABLE analytical_code ALTER COLUMN famille_id DROP NOT NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE analytical_code
        DROP CONSTRAINT IF EXISTS analytical_code_famille_id_fkey;
    `);
    await queryRunner.query(`
      ALTER TABLE analytical_code
        ADD CONSTRAINT analytical_code_famille_id_fkey
          FOREIGN KEY (famille_id) REFERENCES analytical_famille(id) ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rétablir NOT NULL (nécessite que toutes les lignes aient une valeur)
    await queryRunner.query(`UPDATE analytical_lot SET nature = 'material' WHERE nature IS NULL;`);
    await queryRunner.query(`ALTER TABLE analytical_lot ALTER COLUMN nature SET NOT NULL;`);

    await queryRunner.query(`ALTER TABLE analytical_famille ALTER COLUMN nature SET NOT NULL;`);

    // lot_id et famille_id : on ne peut pas rétablir NOT NULL si des lignes ont NULL
    // On laisse nullable en down pour ne pas perdre de données.
  }
}
