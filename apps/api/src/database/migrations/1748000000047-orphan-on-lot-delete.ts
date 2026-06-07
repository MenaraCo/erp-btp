import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suppression d'un lot/famille = orphelinage (et non cascade) — retour UX.
 *
 * Avant : supprimer un lot effaçait en cascade ses familles + leurs codes (perte de données).
 * Après : la famille (resp. le code) devient ORPHELINE — son lot_id (resp. famille_id) passe à
 * NULL, et l'UI invite à la rattacher. Aucune donnée perdue.
 *
 * Change le FK de ON DELETE CASCADE → ON DELETE SET NULL et rend la colonne nullable.
 */
export class OrphanOnLotDelete1748000000047 implements MigrationInterface {
  name = 'OrphanOnLotDelete1748000000047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Famille → Lot ──
    await queryRunner.query(`ALTER TABLE analytical_famille DROP CONSTRAINT IF EXISTS analytical_famille_lot_id_fkey;`);
    await queryRunner.query(`ALTER TABLE analytical_famille ALTER COLUMN lot_id DROP NOT NULL;`);
    await queryRunner.query(`
      ALTER TABLE analytical_famille
        ADD CONSTRAINT analytical_famille_lot_id_fkey
        FOREIGN KEY (lot_id) REFERENCES analytical_lot(id) ON DELETE SET NULL;
    `);

    // ── Code → Famille ──
    await queryRunner.query(`ALTER TABLE analytical_code DROP CONSTRAINT IF EXISTS analytical_code_famille_id_fkey;`);
    await queryRunner.query(`ALTER TABLE analytical_code ALTER COLUMN famille_id DROP NOT NULL;`);
    await queryRunner.query(`
      ALTER TABLE analytical_code
        ADD CONSTRAINT analytical_code_famille_id_fkey
        FOREIGN KEY (famille_id) REFERENCES analytical_famille(id) ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Retour au cascade : on rattache d'abord les orphelins à un lot/famille quelconque
    // pour pouvoir reposer le NOT NULL (sinon échec). Best-effort.
    await queryRunner.query(`
      UPDATE analytical_famille SET lot_id = (SELECT id FROM analytical_lot LIMIT 1)
      WHERE lot_id IS NULL;
    `);
    await queryRunner.query(`
      UPDATE analytical_code SET famille_id = (SELECT id FROM analytical_famille LIMIT 1)
      WHERE famille_id IS NULL;
    `);
    await queryRunner.query(`ALTER TABLE analytical_code DROP CONSTRAINT IF EXISTS analytical_code_famille_id_fkey;`);
    await queryRunner.query(`ALTER TABLE analytical_code ALTER COLUMN famille_id SET NOT NULL;`);
    await queryRunner.query(`
      ALTER TABLE analytical_code
        ADD CONSTRAINT analytical_code_famille_id_fkey
        FOREIGN KEY (famille_id) REFERENCES analytical_famille(id) ON DELETE CASCADE;
    `);
    await queryRunner.query(`ALTER TABLE analytical_famille DROP CONSTRAINT IF EXISTS analytical_famille_lot_id_fkey;`);
    await queryRunner.query(`ALTER TABLE analytical_famille ALTER COLUMN lot_id SET NOT NULL;`);
    await queryRunner.query(`
      ALTER TABLE analytical_famille
        ADD CONSTRAINT analytical_famille_lot_id_fkey
        FOREIGN KEY (lot_id) REFERENCES analytical_lot(id) ON DELETE CASCADE;
    `);
  }
}
