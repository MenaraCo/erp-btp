import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fiche affaire enrichie — informations descriptives saisies à la création (ou plus tard).
 *
 * - nature_travaux : la nature de l'opération (neuf, rénovation, réhabilitation…), texte libre.
 * - lots_traites : les lots que l'entreprise traite sur l'affaire (peinture, sols, gros œuvre…).
 * - conditions_paiement : les conditions convenues (acompte, délai, retenue de garantie…).
 *
 * Trois champs texte, additifs et réversibles : aucune reprise ni suppression de données.
 * Le responsable et le conducteur de travaux existent déjà (migration 076).
 */
export class AffaireDetails1748000000081 implements MigrationInterface {
  name = 'AffaireDetails1748000000081';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE affaire
        ADD COLUMN nature_travaux      text NULL,
        ADD COLUMN lots_traites        text NULL,
        ADD COLUMN conditions_paiement text NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE affaire
        DROP COLUMN IF EXISTS nature_travaux,
        DROP COLUMN IF EXISTS lots_traites,
        DROP COLUMN IF EXISTS conditions_paiement;
    `);
  }
}
