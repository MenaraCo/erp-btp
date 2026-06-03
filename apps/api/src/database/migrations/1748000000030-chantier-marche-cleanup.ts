import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chantier 1→N Marché — refactor step b.4 (nettoyage). Now that the étude d'exécution and the
 * contre-étude live on the marché (services updated), tightens the new links to NOT NULL and
 * drops the vestigial chantier columns. Reversible.
 */
export class ChantierMarcheCleanup1748000000030 implements MigrationInterface {
  name = 'ChantierMarcheCleanup1748000000030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE marche ALTER COLUMN chantier_id SET NOT NULL;`);
    await queryRunner.query(`ALTER TABLE execution_line ALTER COLUMN marche_id SET NOT NULL;`);
    await queryRunner.query(`ALTER TABLE nomenclature_resource ALTER COLUMN marche_id SET NOT NULL;`);

    // Vestigial chantier columns: a chantier is a pure aggregation unit; lineage + étude d'exécution
    // metadata now belong to the marché.
    await queryRunner.query(`ALTER TABLE chantier DROP COLUMN IF EXISTS contre_etude_status;`);
    await queryRunner.query(`ALTER TABLE chantier DROP COLUMN IF EXISTS execution_form;`);
    await queryRunner.query(`ALTER TABLE chantier DROP COLUMN IF EXISTS marche_id;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE chantier ADD COLUMN marche_id uuid NULL REFERENCES marche(id) ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE chantier ADD COLUMN execution_form varchar(24) NOT NULL DEFAULT 'by_ouvrage';`,
    );
    await queryRunner.query(
      `ALTER TABLE chantier ADD COLUMN contre_etude_status varchar(16) NOT NULL DEFAULT 'draft';`,
    );
    await queryRunner.query(`ALTER TABLE nomenclature_resource ALTER COLUMN marche_id DROP NOT NULL;`);
    await queryRunner.query(`ALTER TABLE execution_line ALTER COLUMN marche_id DROP NOT NULL;`);
    await queryRunner.query(`ALTER TABLE marche ALTER COLUMN chantier_id DROP NOT NULL;`);
  }
}
