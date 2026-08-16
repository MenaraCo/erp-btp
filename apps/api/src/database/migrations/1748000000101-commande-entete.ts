import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * En-tête d'un bon de commande : ce qu'un fournisseur doit lire avant de livrer.
 *
 * Une commande sans adresse ni date de livraison n'est pas une commande : c'est une liste de
 * prix. Ces champs partiront sur le PDF envoyé au fournisseur, et la date souhaitée sert de
 * repère au conducteur quand il attend sa livraison.
 *
 * `delivery_address` est un TEXTE libre, pas une référence au chantier : on livre parfois au
 * dépôt, chez un client, ou à une adresse de chantier différente de l'adresse administrative.
 */
export class CommandeEntete1748000000101 implements MigrationInterface {
  name = 'CommandeEntete1748000000101';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_order
        ADD COLUMN delivery_address    text NULL,
        ADD COLUMN delivery_date       date NULL,
        ADD COLUMN delivery_conditions text NULL,
        ADD COLUMN payment_terms       text NULL,
        ADD COLUMN notes               text NULL,
        ADD COLUMN contact             varchar(128) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_order
        DROP COLUMN IF EXISTS delivery_address,
        DROP COLUMN IF EXISTS delivery_date,
        DROP COLUMN IF EXISTS delivery_conditions,
        DROP COLUMN IF EXISTS payment_terms,
        DROP COLUMN IF EXISTS notes,
        DROP COLUMN IF EXISTS contact;
    `);
  }
}
