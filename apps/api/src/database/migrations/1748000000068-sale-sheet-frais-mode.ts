import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * E.2 — Traitement des frais annexes sur l'édition :
 *  - 'separe' (défaut) : poste distinct, visible par le client (comportement actuel) ;
 *  - 'inclus'          : montant noyé dans les prix unitaires, invisible sur le devis.
 * Le total HT est identique dans les deux cas.
 */
export class SaleSheetFraisMode1748000000068 implements MigrationInterface {
  name = 'SaleSheetFraisMode1748000000068';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE sale_sheet
        ADD COLUMN frais_mode varchar(8) NOT NULL DEFAULT 'separe'
          CHECK (frais_mode IN ('separe', 'inclus'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE sale_sheet DROP COLUMN IF EXISTS frais_mode;`);
  }
}
