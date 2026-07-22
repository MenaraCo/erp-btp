import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Promo codes (cahier des charges §3.7 B — "gestion des codes promo" in the editor back-office).
 *
 * `promo_code` is editor-owned catalogue data: global, NOT tenant-scoped, so no RLS (same status
 * as module / pack / capability). A subscription references at most one active promo code; the
 * discount is applied when pricing the subscription (MRR and quotes).
 *
 * Discount is either a percentage (`percent`, 0-100) or a fixed amount in € (`fixed`).
 * `valid_from` / `valid_until` bound the window (NULL = unbounded); `max_redemptions` caps usage
 * (NULL = unlimited) and `redemptions` counts applications.
 */
export class PromoCodes1748000000054 implements MigrationInterface {
  name = 'PromoCodes1748000000054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE promo_code (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code             varchar(32) NOT NULL UNIQUE,
        label            varchar(255) NULL,
        discount_type    varchar(16) NOT NULL,
        discount_value   numeric(10,2) NOT NULL,
        active           boolean NOT NULL DEFAULT true,
        valid_from       timestamptz NULL,
        valid_until      timestamptz NULL,
        max_redemptions  integer NULL,
        redemptions      integer NOT NULL DEFAULT 0,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT promo_code_discount_type_chk CHECK (discount_type IN ('percent', 'fixed')),
        CONSTRAINT promo_code_discount_value_chk CHECK (discount_value >= 0),
        CONSTRAINT promo_code_percent_range_chk
          CHECK (discount_type <> 'percent' OR discount_value <= 100)
      );
    `);

    await queryRunner.query(`
      ALTER TABLE subscription
        ADD COLUMN promo_code_id uuid NULL REFERENCES promo_code(id) ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE subscription DROP COLUMN IF EXISTS promo_code_id;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS promo_code;`);
  }
}
