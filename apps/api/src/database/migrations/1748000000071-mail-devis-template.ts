import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Modèle de mail d'envoi de devis, paramétrable par société.
 *
 * Objet et corps acceptent des variables remplacées à l'envoi : {CLIENT}, {DEVIS}, {AFFAIRE},
 * {MONTANT_HT}, {MONTANT_TTC}, {DATE}, {SOCIETE}. Le mail est ensuite ouvert dans le client
 * de messagerie de l'utilisateur (mailto), le PDF étant téléchargé à côté pour être joint.
 */
export class MailDevisTemplate1748000000071 implements MigrationInterface {
  name = 'MailDevisTemplate1748000000071';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE company_preferences
        ADD COLUMN mail_devis_objet text NOT NULL
          DEFAULT 'Devis {DEVIS} — {AFFAIRE}',
        ADD COLUMN mail_devis_corps text NOT NULL
          DEFAULT E'Bonjour {CLIENT},\\n\\nVeuillez trouver ci-joint notre devis {DEVIS} concernant {AFFAIRE}, d''un montant de {MONTANT_TTC} TTC.\\n\\nNous restons à votre disposition pour tout complément d''information.\\n\\nCordialement,\\n{SOCIETE}';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE company_preferences
        DROP COLUMN IF EXISTS mail_devis_corps,
        DROP COLUMN IF EXISTS mail_devis_objet;
    `);
  }
}
