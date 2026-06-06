import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nature éditable sur la famille et le code analytique (retour UX).
 *
 * Motif : les lots sont des lots de TRAVAUX (Gros œuvre, Peinture…) qui mélangent plusieurs
 * natures (un lot Peinture = main d'œuvre + matériaux). La nature ne peut donc pas être déduite
 * du lot. On l'attache directement à la famille et au code analytique, éditable.
 *
 * Additif et non destructif : on AJOUTE des colonnes nature (backfillées depuis le lot),
 * on conserve analytical_lot.nature (le moteur analytique continue de fonctionner).
 */
export class NatureOnFamilleCode1748000000046 implements MigrationInterface {
  name = 'NatureOnFamilleCode1748000000046';

  private readonly check = `CHECK (nature IN ('material','equipment','subcontract','labor'))`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    /* ── Famille ── */
    await queryRunner.query(`ALTER TABLE analytical_famille ADD COLUMN IF NOT EXISTS nature varchar(16);`);
    await queryRunner.query(`
      UPDATE analytical_famille f SET nature = l.nature
      FROM analytical_lot l WHERE l.id = f.lot_id AND f.nature IS NULL;
    `);
    await queryRunner.query(`ALTER TABLE analytical_famille ALTER COLUMN nature SET DEFAULT 'material';`);
    await queryRunner.query(`UPDATE analytical_famille SET nature = 'material' WHERE nature IS NULL;`);
    await queryRunner.query(`ALTER TABLE analytical_famille ALTER COLUMN nature SET NOT NULL;`);
    await queryRunner.query(`ALTER TABLE analytical_famille ADD CONSTRAINT analytical_famille_nature_chk ${this.check};`);

    /* ── Code analytique ── */
    await queryRunner.query(`ALTER TABLE analytical_code ADD COLUMN IF NOT EXISTS nature varchar(16);`);
    await queryRunner.query(`
      UPDATE analytical_code c SET nature = l.nature
      FROM analytical_famille f
      JOIN analytical_lot l ON l.id = f.lot_id
      WHERE f.id = c.famille_id AND c.nature IS NULL;
    `);
    await queryRunner.query(`ALTER TABLE analytical_code ALTER COLUMN nature SET DEFAULT 'material';`);
    await queryRunner.query(`UPDATE analytical_code SET nature = 'material' WHERE nature IS NULL;`);
    await queryRunner.query(`ALTER TABLE analytical_code ALTER COLUMN nature SET NOT NULL;`);
    await queryRunner.query(`ALTER TABLE analytical_code ADD CONSTRAINT analytical_code_nature_chk ${this.check};`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE analytical_code DROP CONSTRAINT IF EXISTS analytical_code_nature_chk;`);
    await queryRunner.query(`ALTER TABLE analytical_code DROP COLUMN IF EXISTS nature;`);
    await queryRunner.query(`ALTER TABLE analytical_famille DROP CONSTRAINT IF EXISTS analytical_famille_nature_chk;`);
    await queryRunner.query(`ALTER TABLE analytical_famille DROP COLUMN IF EXISTS nature;`);
  }
}
