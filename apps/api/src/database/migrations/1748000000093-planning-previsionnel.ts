import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Planning prévisionnel des heures, et agence d'intérim sur la fiche salarié.
 *
 * Le prévisionnel vit dans SA PROPRE TABLE, et non dans `timesheet`. Sept requêtes agrègent déjà
 * les heures pour calculer le réalisé d'un chantier (résultats, pilotage, gestion mensuelle,
 * devis…) : glisser des heures « prévues » dans la même table obligerait à les filtrer partout,
 * et le jour où l'on en oublierait une, un chantier afficherait des dépenses qui n'ont pas eu
 * lieu. Une table séparée rend cette erreur impossible.
 *
 * Un prévisionnel est unique par salarié et par jour : on planifie une journée, pas des fractions
 * dispersées. Le réalisé, lui, garde plusieurs lignes par jour (une par ouvrage).
 */
export class PlanningPrevisionnel1748000000093 implements MigrationInterface {
  name = 'PlanningPrevisionnel1748000000093';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE timesheet_forecast (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id  uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        employee_id  uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
        work_date    date NOT NULL,
        hours        numeric(10,2) NOT NULL DEFAULT 0,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        UNIQUE (chantier_id, employee_id, work_date)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_forecast_periode ON timesheet_forecast(chantier_id, work_date);`,
    );
    await this.enableRls(queryRunner, 'timesheet_forecast');

    // Intérim : savoir de quelle agence vient la personne, pour la refacturation et les contrats.
    await queryRunner.query(`ALTER TABLE employee ADD COLUMN agency varchar(128) NULL;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE employee DROP COLUMN IF EXISTS agency;`);
    await queryRunner.query(`DROP TABLE IF EXISTS timesheet_forecast;`);
  }

  private async enableRls(qr: QueryRunner, table: string): Promise<void> {
    await qr.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    await qr.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    await qr.query(`
      CREATE POLICY ${table}_tenant_isolation ON ${table}
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }
}
