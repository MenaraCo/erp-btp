import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Simplification du cycle de vie du devis.
 *
 * La chaîne « Démarrer l'étude → Coefficients proposés → Coefficients validés » décrivait un
 * processus interne de validation qui ne correspondait pas à l'usage : on ne garde que les
 * étapes COMMERCIALES (en cours → envoyé → gagné/perdu, avec relance et révision). Le passage
 * du devis gagné à l'exécution se fait désormais par l'outil d'acceptation de commande.
 *
 * Les statuts supprimés retombent sur « open » (devis en cours de chiffrage).
 */
export class SimplifyDevisStatus1748000000072 implements MigrationInterface {
  name = 'SimplifyDevisStatus1748000000072';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE devis SET status = 'open'
       WHERE status IN ('study', 'coeffs_proposed', 'coeffs_validated');
    `);
  }

  public async down(): Promise<void> {
    // Irréversible par nature : on ne sait pas à quelle étape intermédiaire chaque devis était.
  }
}
