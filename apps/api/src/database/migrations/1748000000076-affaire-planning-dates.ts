import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Jalons de l'affaire — étude puis réalisation.
 *
 * Les dates vivaient sur le DEVIS, ce qui ne tient pas : une affaire porte plusieurs devis (un par
 * lot) mais UNE seule date limite de remise, un seul démarrage de travaux. Le pilotage des délais
 * (retards, charge par responsable, calendrier) se fait donc au niveau de l'affaire.
 *
 * - Étude : date limite de remise (celle du client), retour effectif (quand on a réellement remis),
 *   début et fin des études.
 * - Réalisation : conducteur de travaux, début et fin de chantier — renseignés quand l'affaire est
 *   gagnée.
 *
 * Additif et réversible : les dates du devis restent en place, rien n'est repris ni supprimé.
 */
export class AffairePlanningDates1748000000076 implements MigrationInterface {
  name = 'AffairePlanningDates1748000000076';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE affaire
        ADD COLUMN date_limite_remise   date NULL,
        ADD COLUMN date_retour_effectif date NULL,
        ADD COLUMN date_debut_etudes    date NULL,
        ADD COLUMN date_fin_etudes      date NULL,
        ADD COLUMN conducteur           varchar(255) NULL,
        ADD COLUMN date_debut_travaux   date NULL,
        ADD COLUMN date_fin_travaux     date NULL;
    `);
    // Le planning trie et filtre par échéance : un index évite un balayage complet dès que le
    // portefeuille grossit.
    await queryRunner.query(
      `CREATE INDEX idx_affaire_date_limite ON affaire(tenant_id, date_limite_remise);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_affaire_date_limite;`);
    await queryRunner.query(`
      ALTER TABLE affaire
        DROP COLUMN IF EXISTS date_limite_remise,
        DROP COLUMN IF EXISTS date_retour_effectif,
        DROP COLUMN IF EXISTS date_debut_etudes,
        DROP COLUMN IF EXISTS date_fin_etudes,
        DROP COLUMN IF EXISTS conducteur,
        DROP COLUMN IF EXISTS date_debut_travaux,
        DROP COLUMN IF EXISTS date_fin_travaux;
    `);
  }
}
