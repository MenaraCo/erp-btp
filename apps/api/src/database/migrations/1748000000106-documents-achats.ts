import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pièces justificatives d'une commande : bons de livraison et factures fournisseur reçus.
 *
 * Le document est conservé AVEC la commande — c'est lui qui fait foi en cas de litige, et le
 * chercher dans une boîte mail six mois plus tard est le meilleur moyen de ne pas le trouver.
 *
 * `texte_extrait` garde ce que la lecture automatique a pu tirer du fichier. On l'enregistre pour
 * deux raisons : la relecture d'une proposition douteuse, et l'absence de relecture du fichier à
 * chaque affichage. Quand le document n'a pas de couche texte (un scan), la colonne reste vide et
 * l'écran le dit : la saisie se fait alors à la main, sans faire croire à une lecture réussie.
 */
export class DocumentsAchats1748000000106 implements MigrationInterface {
  name = 'DocumentsAchats1748000000106';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE purchase_document (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        order_id       uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
        type           varchar(16) NOT NULL,
        nom_fichier    varchar(255) NOT NULL,
        mime           varchar(128) NOT NULL,
        taille         int NOT NULL,
        contenu        bytea NOT NULL,
        texte_extrait  text NULL,
        lecture_statut varchar(16) NOT NULL DEFAULT 'non_lu',
        auteur_id      uuid NULL REFERENCES user_account(id) ON DELETE SET NULL,
        created_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT document_type_connu CHECK (type IN ('delivery', 'invoice', 'autre')),
        CONSTRAINT document_lecture_connue CHECK (lecture_statut IN ('non_lu', 'lu', 'sans_texte'))
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_document_commande ON purchase_document(order_id, created_at DESC);`,
    );
    await queryRunner.query(`ALTER TABLE purchase_document ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE purchase_document FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY purchase_document_tenant_isolation ON purchase_document
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS purchase_document;`);
  }
}
