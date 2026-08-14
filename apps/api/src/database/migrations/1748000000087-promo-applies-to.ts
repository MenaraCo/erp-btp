import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Portée d'un code promo : mensuel (sans engagement), annuel (engagement 12 mois), ou les deux.
 *
 * L'éditeur doit pouvoir réserver une offre à une formule — p. ex. une remise qui n'encourage que
 * l'engagement annuel. `applies_to` porte ce choix ; `both` (défaut) conserve le comportement
 * antérieur (le code s'applique quelle que soit la formule).
 */
export class PromoAppliesTo1748000000087 implements MigrationInterface {
  name = 'PromoAppliesTo1748000000087';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE promo_code
         ADD COLUMN applies_to varchar(16) NOT NULL DEFAULT 'both'
         CHECK (applies_to IN ('monthly', 'annual', 'both'));`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE promo_code DROP COLUMN IF EXISTS applies_to;`);
  }
}
