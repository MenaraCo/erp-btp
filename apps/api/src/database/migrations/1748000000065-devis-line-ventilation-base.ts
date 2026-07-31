import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B.2 — Clé de ventilation des frais (feuille de vente type ONAYA).
 *
 * Une ligne NON VENDABLE (frais de chantier, frais divers) se répartit sur les lignes vendables.
 * ONAYA distingue l'assiette de cette répartition :
 *   - 'propre' : les frais ne pèsent que sur la part propre (MO / matériaux / matériel)
 *   - 'st'     : ils ne pèsent que sur la sous-traitance
 *   - 'all'    : sur l'ensemble du déboursé (défaut = comportement historique)
 *
 * NULL ⇒ 'all', donc additif et sans effet sur les devis existants.
 */
export class DevisLineVentilationBase1748000000065 implements MigrationInterface {
  name = 'DevisLineVentilationBase1748000000065';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE devis_line
        ADD COLUMN ventilation_base varchar(8) NULL
          CHECK (ventilation_base IN ('propre', 'st', 'all'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE devis_line DROP COLUMN IF EXISTS ventilation_base;`);
  }
}
