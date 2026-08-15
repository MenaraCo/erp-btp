import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Créneaux horaires sur les heures pointées et planifiées.
 *
 * Jusqu'ici une journée se résumait à un NOMBRE d'heures. On ne pouvait donc pas distinguer deux
 * chantiers faits l'un le matin, l'autre l'après-midi (parfaitement normal) d'un salarié annoncé
 * au même moment sur deux chantiers (impossible). Le début et la fin rendent le chevauchement
 * détectable, et permettent une vue calendrier par tranches horaires.
 *
 * Les deux colonnes restent FACULTATIVES : beaucoup d'entreprises pointent en volume d'heures
 * sans horaire précis, et leur imposer une heure de début inventée dégraderait la donnée.
 */
export class CreneauxHoraires1748000000095 implements MigrationInterface {
  name = 'CreneauxHoraires1748000000095';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['timesheet', 'timesheet_forecast']) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN start_time time NULL;`);
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN end_time time NULL;`);
      // Un créneau doit se tenir : soit les deux bornes, soit aucune, et la fin après le début.
      await queryRunner.query(`
        ALTER TABLE ${table} ADD CONSTRAINT ${table}_creneau_coherent
          CHECK (
            (start_time IS NULL AND end_time IS NULL)
            OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
          );
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['timesheet', 'timesheet_forecast']) {
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_creneau_coherent;`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS end_time;`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS start_time;`);
    }
  }
}
