import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Numéro personnalisé sur une ligne de devis (titre/sous-titre) — override de la numérotation
 * automatique du montage (convention CHIFFRAGE). Nullable, additif.
 */
export class DevisLineNumCustom1748000000049 implements MigrationInterface {
  name = 'DevisLineNumCustom1748000000049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE devis_line ADD COLUMN IF NOT EXISTS num_custom varchar(32) NULL;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE devis_line DROP COLUMN IF EXISTS num_custom;`);
  }
}
