import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Informations d'ACHAT portées par la ligne de commande elle-même.
 *
 * Une ligne pouvait venir de trois endroits — la nomenclature du chantier, la bibliothèque
 * générale, ou une saisie libre — et seules les premières savaient dire « référence fournisseur
 * PP-4412, vendu au sac de 25 kg ». Ces informations descendent donc sur la ligne, COPIÉES à
 * l'insertion comme partout ailleurs : la commande reste vraie même si le catalogue change ensuite,
 * et une ligne libre peut porter les mêmes renseignements qu'une ligne de catalogue.
 *
 * `library_resource_id` garde la trace de l'article d'origine sans créer de dépendance : la
 * suppression d'un article de catalogue ne doit pas effacer l'historique d'une commande.
 */
export class CommandeLigneTechnique1748000000103 implements MigrationInterface {
  name = 'CommandeLigneTechnique1748000000103';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_order_line
        ADD COLUMN library_resource_id uuid NULL REFERENCES resource(id) ON DELETE SET NULL,
        ADD COLUMN ref_fournisseur     varchar(64) NULL,
        ADD COLUMN unite_achat         varchar(16) NULL,
        ADD COLUMN coeff_conversion    numeric(14,6) NULL,
        ADD COLUMN code_produit        varchar(64) NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE purchase_order_line
        ADD CONSTRAINT po_line_coeff_positif
        CHECK (coeff_conversion IS NULL OR coeff_conversion > 0);
    `);

    // Reprise : les lignes déjà créées depuis la nomenclature portent déjà ces informations.
    await queryRunner.query(`
      UPDATE purchase_order_line l
         SET ref_fournisseur  = n.ref_fournisseur,
             unite_achat      = n.unite_achat,
             coeff_conversion = n.coeff_conversion
        FROM nomenclature_resource n
       WHERE n.id = l.nomenclature_resource_id;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE purchase_order_line
        DROP CONSTRAINT IF EXISTS po_line_coeff_positif,
        DROP COLUMN IF EXISTS library_resource_id,
        DROP COLUMN IF EXISTS ref_fournisseur,
        DROP COLUMN IF EXISTS unite_achat,
        DROP COLUMN IF EXISTS coeff_conversion,
        DROP COLUMN IF EXISTS code_produit;
    `);
  }
}
