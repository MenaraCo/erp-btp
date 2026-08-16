import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Journal des messages sortants (bons de commande envoyés au fournisseur, et la suite).
 *
 * Deux raisons de tout écrire ici plutôt que de « juste envoyer » :
 *
 * — la preuve : six mois plus tard, la question n'est pas « a-t-on cliqué ? » mais « qu'a-t-on
 *   envoyé, à qui, et quand » ;
 * — l'honnêteté : tant qu'aucune messagerie n'est configurée, le message est enregistré en
 *   ATTENTE et l'écran le dit. Afficher « envoyé » sans expédier serait le pire des mensonges —
 *   on croirait le fournisseur prévenu.
 */
export class Messagerie1748000000105 implements MigrationInterface {
  name = 'Messagerie1748000000105';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE email_message (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        destinataires  text NOT NULL,
        copies         text NULL,
        sujet          varchar(255) NOT NULL,
        corps          text NOT NULL,
        piece_jointe   varchar(255) NULL,
        objet_type     varchar(32) NULL,
        objet_id       uuid NULL,
        statut         varchar(16) NOT NULL DEFAULT 'pending',
        erreur         text NULL,
        expedie_le     timestamptz NULL,
        auteur_id      uuid NULL REFERENCES user_account(id) ON DELETE SET NULL,
        created_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT email_statut_connu CHECK (statut IN ('pending', 'sent', 'failed'))
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_email_objet ON email_message(objet_type, objet_id, created_at DESC);`,
    );
    await queryRunner.query(`ALTER TABLE email_message ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE email_message FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY email_message_tenant_isolation ON email_message
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);

    // Quand la commande est partie, et à qui : lisible sans ouvrir le journal des messages.
    await queryRunner.query(`
      ALTER TABLE purchase_order
        ADD COLUMN sent_at timestamptz NULL,
        ADD COLUMN sent_to text NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_order
        DROP COLUMN IF EXISTS sent_at,
        DROP COLUMN IF EXISTS sent_to;
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS email_message;`);
  }
}
