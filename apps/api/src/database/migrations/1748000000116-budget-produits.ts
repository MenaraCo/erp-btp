import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Charges, frais généraux et PRODUITS : de quoi lire un résultat de chantier.
 *
 * Jusqu'ici le plan analytique ne connaissait que la dépense — quatre natures de charge. Un budget
 * de chantier qui n'affiche que des charges ne répond jamais à la seule question qui compte :
 * « est-ce qu'on gagne de l'argent ? ». Il manque les recettes (le marché), et les produits
 * NÉGATIFS qui les grèvent (compte prorata, retenue de garantie).
 *
 * Le code analytique porte donc une CATÉGORIE, comme l'A.R.C. d'Onaya qui est typée charges ou
 * produits : `charge` (l'exploitation), `frais_generaux` (la structure, présentée à part car elle
 * ne se pilote pas comme un poste de chantier), `produit` (les recettes, positives ou négatives).
 * Trois blocs, deux résultats : brut (produits − charges) et net (brut − frais généraux).
 *
 * La catégorie est portée par le CODE et non par le lot : c'est le niveau où l'imputation se fait,
 * et une société peut vouloir un poste de recette rangé dans un lot de travaux existant.
 */
export class BudgetProduits1748000000116 implements MigrationInterface {
  name = 'BudgetProduits1748000000116';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE analytical_code
        ADD COLUMN categorie varchar(16) NOT NULL DEFAULT 'charge'
          CHECK (categorie IN ('charge', 'frais_generaux', 'produit'));
    `);

    // Un lot / une famille peuvent désormais porter une section hors charges, pour que les postes
    // de recette aient une place propre dans l'arbre au lieu d'être glissés dans « Matériaux ».
    const naturesElargies =
      `CHECK (nature IN ('material','equipment','subcontract','labor','site_overhead','frais_generaux','produit'))`;
    // Les contraintes portent deux noms selon leur migration d'origine (`_check` posé en ligne à la
    // création, `_chk` ajouté ensuite) : on retire les deux avant de reposer la bonne.
    for (const table of ['analytical_lot', 'analytical_famille', 'analytical_code']) {
      for (const suffixe of ['check', 'chk']) {
        await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_nature_${suffixe};`);
      }
      await queryRunner.query(
        `ALTER TABLE ${table} ADD CONSTRAINT ${table}_nature_chk ${naturesElargies};`,
      );
    }

    // Un mouvement de budget peut désormais viser une recette.
    await queryRunner.query(
      `ALTER TABLE chantier_budget_movement DROP CONSTRAINT IF EXISTS chantier_budget_movement_nature_check;`,
    );
    await queryRunner.query(`
      ALTER TABLE chantier_budget_movement ADD CONSTRAINT chantier_budget_movement_nature_check
        CHECK (nature IN ('labor','material','equipment','subcontract','site_overhead','frais_generaux','produit'));
    `);
    await queryRunner.query(
      `ALTER TABLE chantier_budget_initial DROP CONSTRAINT IF EXISTS chantier_budget_initial_nature_check;`,
    );
    await queryRunner.query(`
      ALTER TABLE chantier_budget_initial ADD CONSTRAINT chantier_budget_initial_nature_check
        CHECK (nature IN ('labor','material','equipment','subcontract','site_overhead','frais_generaux','produit'));
    `);

    /* Les postes de frais généraux et de produits, pour les tenants qui ont DÉJÀ un plan : sans
       eux, l'écran des budgets afficherait deux blocs vides et aucun résultat. Les codes en
       conflit sont ignorés — une société qui a déjà son 700 garde le sien. */
    const sections: Array<{
      lot: string; lotLabel: string; nature: string; famille: string; familleLabel: string;
      categorie: string; codes: Array<{ code: string; label: string }>;
    }> = [
      {
        lot: 'FG', lotLabel: 'Frais généraux', nature: 'frais_generaux',
        famille: 'FG-GEN', familleLabel: 'Frais généraux', categorie: 'frais_generaux',
        codes: [
          { code: '900', label: 'Frais généraux — part propre' },
          { code: '910', label: 'Frais généraux — sous-traitance' },
        ],
      },
      {
        lot: 'PROD', lotLabel: 'Produits', nature: 'produit',
        famille: 'PROD-TRV', familleLabel: 'Recettes de travaux', categorie: 'produit',
        codes: [
          { code: '800', label: 'Recettes travaux (marché)' },
          { code: '810', label: 'Travaux supplémentaires / avenants' },
          { code: '860', label: 'Compte prorata' },
          { code: '870', label: 'Retenue de garantie' },
        ],
      },
    ];

    const tenants: Array<{ tenant_id: string }> = await queryRunner.query(
      `SELECT DISTINCT tenant_id FROM analytical_lot`,
    );
    for (const { tenant_id } of tenants) {
      for (const s of sections) {
        await queryRunner.query(
          `INSERT INTO analytical_lot (tenant_id, nature, code, label)
             VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, code) DO NOTHING`,
          [tenant_id, s.nature, s.lot, s.lotLabel],
        );
        const [lot] = await queryRunner.query(
          `SELECT id FROM analytical_lot WHERE tenant_id = $1 AND code = $2`,
          [tenant_id, s.lot],
        );
        if (!lot) continue;
        await queryRunner.query(
          `INSERT INTO analytical_famille (tenant_id, lot_id, nature, code, label)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, code) DO NOTHING`,
          [tenant_id, lot.id, s.nature, s.famille, s.familleLabel],
        );
        const [fam] = await queryRunner.query(
          `SELECT id FROM analytical_famille WHERE tenant_id = $1 AND code = $2`,
          [tenant_id, s.famille],
        );
        if (!fam) continue;
        for (const c of s.codes) {
          await queryRunner.query(
            `INSERT INTO analytical_code (tenant_id, famille_id, code, label, nature, categorie)
               VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, code) DO NOTHING`,
            [tenant_id, fam.id, c.code, c.label, s.nature, s.categorie],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM analytical_code WHERE categorie <> 'charge';`);
    await queryRunner.query(`DELETE FROM analytical_famille WHERE code IN ('FG-GEN','PROD-TRV');`);
    await queryRunner.query(`DELETE FROM analytical_lot WHERE code IN ('FG','PROD');`);
    await queryRunner.query(`ALTER TABLE analytical_code DROP COLUMN IF EXISTS categorie;`);
  }
}
