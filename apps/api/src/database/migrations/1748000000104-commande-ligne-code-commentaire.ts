import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Code saisi, ordre des lignes et lignes de COMMENTAIRE.
 *
 * Trois besoins d'une commande réelle :
 *
 * — le code d'article se tape au clavier (on connaît son catalogue par cœur), et il doit pouvoir
 *   retrouver la ressource dans la bibliothèque pour remplir la ligne ;
 * — l'ordre des lignes est celui que l'acheteur décide, pas celui de la saisie : sans colonne
 *   d'ordre, impossible de glisser un commentaire SOUS sa ressource ;
 * — un commentaire (« livrer par la rue arrière », « teinte à valider ») n'est ni une quantité ni
 *   un prix. Il vit sur sa propre ligne, sans montant, et ne compte dans aucun total.
 */
export class CommandeLigneCodeCommentaire1748000000104 implements MigrationInterface {
  name = 'CommandeLigneCodeCommentaire1748000000104';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_order_line
        ADD COLUMN code       varchar(64) NULL,
        ADD COLUMN kind       varchar(16) NOT NULL DEFAULT 'resource',
        ADD COLUMN sort_order int NOT NULL DEFAULT 0;
    `);
    await queryRunner.query(`
      ALTER TABLE purchase_order_line
        ADD CONSTRAINT po_line_kind_connu CHECK (kind IN ('resource', 'comment'));
    `);

    // Ordre initial = ordre de saisie : on reprend l'existant sans le bousculer.
    await queryRunner.query(`
      UPDATE purchase_order_line l
         SET sort_order = r.rang
        FROM (
          SELECT id, (ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at))::int * 10 AS rang
            FROM purchase_order_line
        ) r
       WHERE r.id = l.id;
    `);

    // Le code affiché vient de la ressource d'origine quand il y en a une.
    await queryRunner.query(`
      UPDATE purchase_order_line l SET code = n.code
        FROM nomenclature_resource n WHERE n.id = l.nomenclature_resource_id;
    `);
    await queryRunner.query(`
      UPDATE purchase_order_line l SET code = r.code
        FROM resource r WHERE r.id = l.library_resource_id AND l.code IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_order_line
        DROP CONSTRAINT IF EXISTS po_line_kind_connu,
        DROP COLUMN IF EXISTS code,
        DROP COLUMN IF EXISTS kind,
        DROP COLUMN IF EXISTS sort_order;
    `);
  }
}
