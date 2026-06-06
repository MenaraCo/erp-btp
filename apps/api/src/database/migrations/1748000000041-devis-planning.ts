import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Planning des études (organigramme CHIFFRAGE) : le devis porte un responsable d'étude, une
 * priorité et des échéances (début / échéance) pour alimenter les vues Gantt / Charge.
 * Additif nullable, réversible.
 */
export class DevisPlanning1748000000041 implements MigrationInterface {
  name = 'DevisPlanning1748000000041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE devis
        ADD COLUMN responsable varchar(255) NULL,
        ADD COLUMN priorite varchar(16) NOT NULL DEFAULT 'normale'
          CHECK (priorite IN ('basse', 'normale', 'urgente', 'critique')),
        ADD COLUMN date_debut date NULL,
        ADD COLUMN date_echeance date NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE devis
        DROP COLUMN IF EXISTS date_echeance,
        DROP COLUMN IF EXISTS date_debut,
        DROP COLUMN IF EXISTS priorite,
        DROP COLUMN IF EXISTS responsable;
    `);
  }
}
