import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds 'texte' to the devis_line.type CHECK constraint so free-text lines
 * (non-priced notes in the devis body) can be stored.
 */
export class DevisLineTexteType1748000000050 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE devis_line DROP CONSTRAINT IF EXISTS devis_line_type_check`);
    await queryRunner.query(
      `ALTER TABLE devis_line ADD CONSTRAINT devis_line_type_check
         CHECK (type IN ('titre', 'sous_titre', 'ouvrage', 'ressource', 'texte'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Remove texte lines first, then restore the old constraint.
    await queryRunner.query(`DELETE FROM devis_line WHERE type = 'texte'`);
    await queryRunner.query(`ALTER TABLE devis_line DROP CONSTRAINT IF EXISTS devis_line_type_check`);
    await queryRunner.query(
      `ALTER TABLE devis_line ADD CONSTRAINT devis_line_type_check
         CHECK (type IN ('titre', 'sous_titre', 'ouvrage', 'ressource'))`,
    );
  }
}
