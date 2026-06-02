import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pointages main d'œuvre (cahier des charges §5.5) — increment 3.4. Hours logged per
 * salarié/équipe and date, ventilated on an execution line, valued (hours × hourly cost).
 * The total valued cost feeds the financial-management engine's "réalisé" (labor). RLS.
 */
export class CreateTimesheet1748000000023 implements MigrationInterface {
  name = 'CreateTimesheet1748000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE timesheet (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id        uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        execution_line_id  uuid NULL REFERENCES execution_line(id) ON DELETE SET NULL,
        employee_label     varchar(255) NOT NULL,
        work_date          date NOT NULL,
        hours              numeric(10,2) NOT NULL DEFAULT 0,
        hourly_cost        numeric(14,4) NOT NULL DEFAULT 0,
        cost               numeric(16,2) NOT NULL DEFAULT 0,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_timesheet_chantier ON timesheet(chantier_id);`);
    await queryRunner.query(`ALTER TABLE timesheet ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE timesheet FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY timesheet_tenant_isolation ON timesheet
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS timesheet;`);
  }
}
