import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B.3 — Arrondi commercial et PV imposé (feuille de vente type ONAYA).
 *
 *  - arrondi_pas / arrondi_mode : arrondi appliqué au PV CALCULÉ de chaque ligne
 *      (pas = 0 ⇒ aucun arrondi ; mode = proche | sup | inf).
 *  - pv_impose : PV total imposé hors frais annexes et remise. Les lignes non forcées sont
 *      ajustées au prorata pour l'atteindre ; les PV forcés restent intacts.
 *
 * Valeurs par défaut neutres ⇒ aucun effet sur les devis existants.
 */
export class SaleSheetArrondiPvImpose1748000000066 implements MigrationInterface {
  name = 'SaleSheetArrondiPvImpose1748000000066';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE sale_sheet
        ADD COLUMN arrondi_pas numeric(14,4) NOT NULL DEFAULT 0,
        ADD COLUMN arrondi_mode varchar(8) NOT NULL DEFAULT 'proche'
          CHECK (arrondi_mode IN ('proche', 'sup', 'inf')),
        ADD COLUMN pv_impose numeric(14,4) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE sale_sheet
        DROP COLUMN IF EXISTS pv_impose,
        DROP COLUMN IF EXISTS arrondi_mode,
        DROP COLUMN IF EXISTS arrondi_pas;
    `);
  }
}
