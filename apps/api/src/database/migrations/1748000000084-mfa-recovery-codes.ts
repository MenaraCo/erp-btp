import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Codes de secours de la double authentification.
 *
 * Quand la 2FA est active et que l'utilisateur perd son téléphone (donc son appli
 * d'authentification), il doit pouvoir se reconnecter. On stocke un tableau d'EMPREINTES sha256
 * de codes à usage unique (jamais les valeurs en clair) ; chaque code consommé est retiré.
 *
 * Additif et réversible : les comptes sans 2FA gardent une valeur nulle.
 */
export class MfaRecoveryCodes1748000000084 implements MigrationInterface {
  name = 'MfaRecoveryCodes1748000000084';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE user_account ADD COLUMN mfa_recovery_codes jsonb NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE user_account DROP COLUMN IF EXISTS mfa_recovery_codes;`,
    );
  }
}
