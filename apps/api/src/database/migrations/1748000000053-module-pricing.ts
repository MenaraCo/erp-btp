import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the per-seat module price out of catalog.config.ts and into the database, so the editor
 * can change prices from the back-office without a redeployment (cahier des charges §3.2/§3.7 B:
 * "prix pilotés par configuration, jamais codés en dur").
 *
 * After this migration the database is the source of truth for prices: the catalogue seed only
 * sets a price when it *inserts* a new module, never on conflict — otherwise a re-seed would wipe
 * the editor's pricing. The values backfilled here are the config values in force at the time.
 *
 * `NULL` means "sur devis" (enterprise offers), `0` means included in the Socle.
 */
export class ModulePricing1748000000053 implements MigrationInterface {
  name = 'ModulePricing1748000000053';

  private static readonly PRICES: Array<[string, number | null]> = [
    ['core', 0],
    ['estimating', 39],
    ['invoicing', 29],
    ['site_tracking', 49],
    ['stock_equipment', 19],
    ['financial_management', 59],
    ['bim', null],
    ['ai', null],
    ['api', null],
    ['enterprise', null],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE module ADD COLUMN price_monthly numeric(10,2) NULL`,
    );
    for (const [code, price] of ModulePricing1748000000053.PRICES) {
      await queryRunner.query(
        `UPDATE module SET price_monthly = $2, updated_at = now() WHERE code = $1`,
        [code, price],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE module DROP COLUMN IF EXISTS price_monthly`);
  }
}
