import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fiche du salarié complétée — administratif et suivi médical.
 *
 * La fiche ne portait que l'identité et le coût horaire. Il manquait ce qu'un chef d'entreprise
 * cherche quand il ouvre un dossier : depuis quand la personne est là, comment la joindre, sa
 * qualification, et surtout la dernière visite médicale — une visite périmée interdit le chantier.
 *
 * Le numéro de sécurité sociale n'est là que parce que la paye l'exige ; il n'apparaît qu'en
 * consultation de la fiche, jamais dans les listes ni les exports d'écran.
 */
export class FicheSalarie1748000000108 implements MigrationInterface {
  name = 'FicheSalarie1748000000108';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE employee
        ADD COLUMN date_entree          date NULL,
        ADD COLUMN date_sortie          date NULL,
        ADD COLUMN date_naissance       date NULL,
        ADD COLUMN numero_secu          varchar(32) NULL,
        ADD COLUMN telephone            varchar(32) NULL,
        ADD COLUMN email                varchar(255) NULL,
        ADD COLUMN adresse              varchar(255) NULL,
        ADD COLUMN code_postal          varchar(16) NULL,
        ADD COLUMN ville                varchar(128) NULL,
        ADD COLUMN qualification        varchar(64) NULL,
        ADD COLUMN date_visite_medicale date NULL,
        ADD COLUMN commentaire          text NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE employee
        ADD CONSTRAINT employee_sortie_apres_entree
        CHECK (date_sortie IS NULL OR date_entree IS NULL OR date_sortie >= date_entree);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE employee
        DROP CONSTRAINT IF EXISTS employee_sortie_apres_entree,
        DROP COLUMN IF EXISTS date_entree,
        DROP COLUMN IF EXISTS date_sortie,
        DROP COLUMN IF EXISTS date_naissance,
        DROP COLUMN IF EXISTS numero_secu,
        DROP COLUMN IF EXISTS telephone,
        DROP COLUMN IF EXISTS email,
        DROP COLUMN IF EXISTS adresse,
        DROP COLUMN IF EXISTS code_postal,
        DROP COLUMN IF EXISTS ville,
        DROP COLUMN IF EXISTS qualification,
        DROP COLUMN IF EXISTS date_visite_medicale,
        DROP COLUMN IF EXISTS commentaire;
    `);
  }
}
