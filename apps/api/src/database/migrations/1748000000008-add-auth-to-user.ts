import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds first-party authentication fields to user_account (password + TOTP MFA).
 * user_account already has RLS from migration 0005.
 */
export class AddAuthToUser1748000000008 implements MigrationInterface {
  name = 'AddAuthToUser1748000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE user_account ADD COLUMN password_hash varchar(255) NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE user_account ADD COLUMN mfa_enabled boolean NOT NULL DEFAULT false;`,
    );
    await queryRunner.query(
      `ALTER TABLE user_account ADD COLUMN mfa_secret varchar(64) NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_account DROP COLUMN mfa_secret;`);
    await queryRunner.query(`ALTER TABLE user_account DROP COLUMN mfa_enabled;`);
    await queryRunner.query(`ALTER TABLE user_account DROP COLUMN password_hash;`);
  }
}
