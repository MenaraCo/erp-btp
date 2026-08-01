import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mode de traitement PAR POSTE de frais annexe (et non plus global au devis) :
 *  - 'separe' : ligne visible sur le devis, sous son propre intitulé ;
 *  - 'inclus' : montant noyé dans les prix unitaires.
 * Reprend par défaut le mode global du devis (sale_sheet.frais_mode), d'où le NULL initial.
 */
export class FraisAnnexeMode1748000000070 implements MigrationInterface {
  name = 'FraisAnnexeMode1748000000070';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE devis_frais_annexe
        ADD COLUMN mode varchar(8) NULL CHECK (mode IN ('separe', 'inclus'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE devis_frais_annexe DROP COLUMN IF EXISTS mode;`);
  }
}
