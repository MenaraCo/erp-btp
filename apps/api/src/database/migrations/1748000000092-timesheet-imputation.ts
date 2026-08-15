import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Imputation des pointages : le moment où les heures d'une période sont arrêtées.
 *
 * Tant qu'un pointage n'est pas imputé, il se corrige — une faute de frappe (80 h au lieu de 8)
 * ne doit pas polluer le réalisé à vie. Une fois imputé, il est FIGÉ : ces heures ont alimenté un
 * résultat de chantier, parfois déjà présenté au client ou exporté en comptabilité ; les laisser
 * bouger dans le dos ferait mentir un chiffre publié.
 *
 * `imputed_at` NULL = saisie en cours, modifiable.
 */
export class TimesheetImputation1748000000092 implements MigrationInterface {
  name = 'TimesheetImputation1748000000092';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE timesheet ADD COLUMN imputed_at timestamptz NULL;`);
    await queryRunner.query(
      `CREATE INDEX idx_timesheet_imputation ON timesheet(chantier_id, work_date) WHERE imputed_at IS NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_timesheet_imputation;`);
    await queryRunner.query(`ALTER TABLE timesheet DROP COLUMN IF EXISTS imputed_at;`);
  }
}
