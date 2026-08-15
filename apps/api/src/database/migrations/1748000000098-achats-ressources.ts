import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Achats : relier une ligne de commande à la ressource du chantier qu'elle approvisionne.
 *
 * Sans ce lien, impossible de répondre à la seule question qui compte au moment de commander :
 * « combien reste-t-il à approvisionner sur cette ressource ? ». On ressaisissait des désignations
 * à la main, sans jamais savoir si la quantité budgétée était dépassée.
 *
 * La nomenclature de chantier reçoit au passage les informations d'ACHAT de la ressource
 * (fournisseur, référence, unité d'achat, coefficient de conversion). Elles sont COPIÉES au
 * transfert, comme le reste de la nomenclature : le chantier reste indépendant de la bibliothèque
 * d'étude, et une remise négociée sur un chantier ne remonte pas dans le catalogue.
 */
export class AchatsRessources1748000000098 implements MigrationInterface {
  name = 'AchatsRessources1748000000098';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE nomenclature_resource
        ADD COLUMN supplier_id      uuid NULL REFERENCES supplier(id) ON DELETE SET NULL,
        ADD COLUMN ref_fournisseur  varchar(64) NULL,
        ADD COLUMN unite_achat      varchar(16) NULL,
        ADD COLUMN coeff_conversion numeric(14,6) NULL;
    `);
    // Un coefficient nul ou négatif ferait exploser le calcul du prix d'achat.
    await queryRunner.query(`
      ALTER TABLE nomenclature_resource
        ADD CONSTRAINT nomenclature_coeff_positif
        CHECK (coeff_conversion IS NULL OR coeff_conversion > 0);
    `);

    // Reprise des chantiers déjà transférés : on lit la ressource d'origine UNE FOIS, ici.
    await queryRunner.query(`
      UPDATE nomenclature_resource n
         SET supplier_id      = r.supplier_id,
             ref_fournisseur  = r.ref_fournisseur,
             unite_achat      = r.unite_achat,
             coeff_conversion = r.coeff_conversion
        FROM resource r
       WHERE r.id = n.source_resource_id;
    `);

    await queryRunner.query(`
      ALTER TABLE purchase_order_line
        ADD COLUMN nomenclature_resource_id uuid NULL
          REFERENCES nomenclature_resource(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(
      `CREATE INDEX idx_po_line_ressource ON purchase_order_line(nomenclature_resource_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_po_line_ressource;`);
    await queryRunner.query(
      `ALTER TABLE purchase_order_line DROP COLUMN IF EXISTS nomenclature_resource_id;`,
    );
    await queryRunner.query(`
      ALTER TABLE nomenclature_resource
        DROP CONSTRAINT IF EXISTS nomenclature_coeff_positif,
        DROP COLUMN IF EXISTS supplier_id,
        DROP COLUMN IF EXISTS ref_fournisseur,
        DROP COLUMN IF EXISTS unite_achat,
        DROP COLUMN IF EXISTS coeff_conversion;
    `);
  }
}
