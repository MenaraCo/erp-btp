import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * E.1 — Logo d'entreprise pour les éditions (devis PDF, et plus tard factures/situations).
 *
 * Stocké en base64 dans la table company : une image de papier à en-tête pèse quelques dizaines
 * de Ko, ce qui évite d'introduire un stockage d'objets pour un seul fichier par société.
 * La taille est bornée applicativement (voir ParamsService.setCompanyLogo).
 */
export class CompanyLogo1748000000067 implements MigrationInterface {
  name = 'CompanyLogo1748000000067';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE company
        ADD COLUMN logo_data text NULL,
        ADD COLUMN logo_mime varchar(32) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE company
        DROP COLUMN IF EXISTS logo_mime,
        DROP COLUMN IF EXISTS logo_data;
    `);
  }
}
