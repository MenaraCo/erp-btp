import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Durée d'application d'un code promo, en mois.
 *
 * Une remise peut couvrir toute la période d'engagement (annuel = 12 mois) ou seulement ses
 * premiers mois (le 1er, les 2 premiers…) — typiquement une offre de lancement. `duration_months`
 * porte ce choix : NULL = toute la période (comportement antérieur) ; N = les N premiers mois.
 */
export class PromoDurationMonths1748000000088 implements MigrationInterface {
  name = 'PromoDurationMonths1748000000088';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE promo_code
         ADD COLUMN duration_months int NULL
         CHECK (duration_months IS NULL OR (duration_months >= 1 AND duration_months <= 12));`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE promo_code DROP COLUMN IF EXISTS duration_months;`);
  }
}
