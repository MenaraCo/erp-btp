import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ressource — champs d'achat (inspirés de CHIFFRAGE) pour préparer le Calcul Appro :
 *  - prix_public    : prix catalogue (dans l'unité d'ACHAT)
 *  - unite_achat    : unité d'achat (ex. palette, sac)
 *  - coeff_conversion : 1 unité d'achat = coeff unités d'EMPLOI (déboursé = prix_public / coeff)
 *  - supplier_id / ref_fournisseur / conditionnement : approvisionnement
 * Tous nullable (coeff par défaut 1). Additif, réversible.
 */
export class ResourceAchatFields1748000000040 implements MigrationInterface {
  name = 'ResourceAchatFields1748000000040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE resource
        ADD COLUMN prix_public numeric(14,4) NULL,
        ADD COLUMN unite_achat varchar(16) NULL,
        ADD COLUMN coeff_conversion numeric(14,6) NOT NULL DEFAULT 1,
        ADD COLUMN supplier_id uuid NULL REFERENCES supplier(id) ON DELETE SET NULL,
        ADD COLUMN ref_fournisseur varchar(128) NULL,
        ADD COLUMN conditionnement varchar(64) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE resource
        DROP COLUMN IF EXISTS conditionnement,
        DROP COLUMN IF EXISTS ref_fournisseur,
        DROP COLUMN IF EXISTS supplier_id,
        DROP COLUMN IF EXISTS coeff_conversion,
        DROP COLUMN IF EXISTS unite_achat,
        DROP COLUMN IF EXISTS prix_public;
    `);
  }
}
