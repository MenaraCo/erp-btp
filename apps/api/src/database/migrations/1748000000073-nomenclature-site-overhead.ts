import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Les frais de chantier repris du devis (frais généraux, installation, compte prorata, nettoyage…)
 * entrent dans la nomenclature du chantier comme n'importe quel poste de coût. Or ils ne sont ni
 * de la main-d'œuvre, ni du matériau, ni du matériel, ni de la sous-traitance : ils sont des frais
 * de chantier. La contrainte de nature s'ouvre donc à `site_overhead`, la 5e nature de budget déjà
 * utilisée partout ailleurs (BUDGET_NATURES).
 *
 * Réversible : le retour arrière reclasse les postes concernés en « material » avant de restaurer
 * l'ancienne contrainte — aucune ligne n'est supprimée.
 */
export class NomenclatureSiteOverhead1748000000073 implements MigrationInterface {
  name = 'NomenclatureSiteOverhead1748000000073';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE nomenclature_resource
        DROP CONSTRAINT IF EXISTS nomenclature_resource_nature_check;
    `);
    await queryRunner.query(`
      ALTER TABLE nomenclature_resource
        ADD CONSTRAINT nomenclature_resource_nature_check
        CHECK (nature IN ('labor','material','equipment','subcontract','site_overhead'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE nomenclature_resource SET nature = 'material' WHERE nature = 'site_overhead';
    `);
    await queryRunner.query(`
      ALTER TABLE nomenclature_resource
        DROP CONSTRAINT IF EXISTS nomenclature_resource_nature_check;
    `);
    await queryRunner.query(`
      ALTER TABLE nomenclature_resource
        ADD CONSTRAINT nomenclature_resource_nature_check
        CHECK (nature IN ('labor','material','equipment','subcontract'));
    `);
  }
}
