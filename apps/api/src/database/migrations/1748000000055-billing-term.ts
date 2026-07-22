import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Formules d'abonnement (cahier §3.2/§3.4) : engagement et rythme de facturation.
 *
 *  - `billing_term`     : `monthly` (sans engagement) ou `annual` (engagement 12 mois).
 *  - `billing_interval` : `monthly` (mensualisé) ou `yearly` (payé en une fois).
 *    Un abonnement sans engagement ne peut être facturé qu'au mois — garanti par contrainte.
 *  - `commitment_ends_at` : fin de l'engagement annuel. À l'échéance, la reconduction tacite
 *    bascule l'abonnement au mois le mois (il perd donc la remise d'engagement).
 *
 * La reconduction est tacite pour toutes les formules : elle est refusée via le
 * `cancel_at_period_end` existant.
 *
 * `platform_setting` porte les réglages globaux de l'éditeur (clé/valeur), à commencer par la
 * remise d'engagement annuel — le cahier impose que toutes les remises soient pilotées par
 * configuration et jamais codées en dur.
 */
export class BillingTerm1748000000055 implements MigrationInterface {
  name = 'BillingTerm1748000000055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE subscription
        ADD COLUMN billing_term       varchar(16) NOT NULL DEFAULT 'monthly',
        ADD COLUMN billing_interval   varchar(16) NOT NULL DEFAULT 'monthly',
        ADD COLUMN commitment_ends_at timestamptz NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE subscription
        ADD CONSTRAINT subscription_billing_term_chk
          CHECK (billing_term IN ('monthly', 'annual')),
        ADD CONSTRAINT subscription_billing_interval_chk
          CHECK (billing_interval IN ('monthly', 'yearly')),
        ADD CONSTRAINT subscription_no_yearly_without_commitment_chk
          CHECK (billing_term = 'annual' OR billing_interval = 'monthly');
    `);

    await queryRunner.query(`
      CREATE TABLE platform_setting (
        key        varchar(64) PRIMARY KEY,
        value      text NOT NULL,
        label      varchar(255) NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `INSERT INTO platform_setting (key, value, label)
       VALUES ('annual_discount_pct', '10', 'Remise pour engagement annuel (%)')
       ON CONFLICT (key) DO NOTHING;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS platform_setting;`);
    await queryRunner.query(`
      ALTER TABLE subscription
        DROP CONSTRAINT IF EXISTS subscription_no_yearly_without_commitment_chk,
        DROP CONSTRAINT IF EXISTS subscription_billing_interval_chk,
        DROP CONSTRAINT IF EXISTS subscription_billing_term_chk;
    `);
    await queryRunner.query(`
      ALTER TABLE subscription
        DROP COLUMN IF EXISTS commitment_ends_at,
        DROP COLUMN IF EXISTS billing_interval,
        DROP COLUMN IF EXISTS billing_term;
    `);
  }
}
