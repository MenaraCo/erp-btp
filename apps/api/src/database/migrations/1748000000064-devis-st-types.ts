import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B.1 — Types de sous-traitance définis PAR DEVIS (feuille de vente type ONAYA).
 *
 * ONAYA distingue plusieurs sous-traitances (ex. « ST Moyens », « ST Compétence »), chacune
 * portant ses propres FG % et bénéfice %. Ici :
 *  - sale_sheet.st_types : liste des types du devis
 *      [{ id, code, label, tauxFg, tauxBenefice }]
 *  - devis_line.st_type_id : type de ST auquel la ligne est rattachée (n'a de sens que pour
 *      nature = 'subcontract'). NULL = ST non typée → retombe sur les taux de la nature.
 *
 * Additif et réversible : sans type déclaré, le calcul reste identique à l'existant.
 */
export class DevisStTypes1748000000064 implements MigrationInterface {
  name = 'DevisStTypes1748000000064';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE sale_sheet
        ADD COLUMN st_types jsonb NOT NULL DEFAULT '[]'::jsonb;
    `);
    await queryRunner.query(`
      ALTER TABLE devis_line
        ADD COLUMN st_type_id varchar(64) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE devis_line DROP COLUMN IF EXISTS st_type_id;`);
    await queryRunner.query(`ALTER TABLE sale_sheet DROP COLUMN IF EXISTS st_types;`);
  }
}
