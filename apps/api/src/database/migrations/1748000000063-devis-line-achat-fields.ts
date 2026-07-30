import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * devis_line — champs d'achat (copiés de la ressource bibliothèque à l'ajout, puis éditables
 * dans le devis SANS toucher la bibliothèque) :
 *  - unite_achat      : unité d'achat (l'unité d'emploi est la colonne `unit` existante)
 *  - coeff_conversion : 1 unité d'achat = coeff unités d'emploi (Calcul Appro)
 *  - supplier_id      : distributeur
 *  - ref_fournisseur / conditionnement : approvisionnement
 * Tous nullable (null = retomber sur la ressource source si liée). Additif, réversible.
 */
export class DevisLineAchatFields1748000000063 implements MigrationInterface {
  name = 'DevisLineAchatFields1748000000063';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE devis_line
        ADD COLUMN unite_achat varchar(16) NULL,
        ADD COLUMN coeff_conversion numeric(14,6) NULL,
        ADD COLUMN supplier_id uuid NULL REFERENCES supplier(id) ON DELETE SET NULL,
        ADD COLUMN ref_fournisseur varchar(128) NULL,
        ADD COLUMN conditionnement varchar(64) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE devis_line
        DROP COLUMN IF EXISTS conditionnement,
        DROP COLUMN IF EXISTS ref_fournisseur,
        DROP COLUMN IF EXISTS supplier_id,
        DROP COLUMN IF EXISTS coeff_conversion,
        DROP COLUMN IF EXISTS unite_achat;
    `);
  }
}
