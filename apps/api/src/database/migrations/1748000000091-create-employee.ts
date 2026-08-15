import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fichier des salariés — le référentiel qui manquait à la saisie des heures.
 *
 * Le pointage désignait l'ouvrier par un TEXTE LIBRE : deux orthographes du même nom donnaient
 * deux personnes, aucun taux horaire n'était mémorisé, et l'on ne pouvait ni contrôler un
 * pointage ni préparer une paye. Le salarié devient une fiche : un code, une identité, une
 * qualification et un coût horaire — repris automatiquement à la saisie, et modifiable au cas par
 * cas (heure de nuit, intérim, etc.).
 *
 * `employee_label` reste sur le pointage : c'est la trace de ce qui a été saisi à l'époque, qui
 * ne doit pas changer si la fiche est renommée plus tard.
 */
export class CreateEmployee1748000000091 implements MigrationInterface {
  name = 'CreateEmployee1748000000091';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE employee (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        code          varchar(64) NOT NULL,
        first_name    varchar(128) NULL,
        last_name     varchar(128) NOT NULL,
        job_title     varchar(128) NULL,
        /* Coût horaire de revient : ce que l'heure coûte à l'entreprise, pas le salaire brut. */
        hourly_cost   numeric(14,4) NOT NULL DEFAULT 0,
        /* Type de contrat : un intérimaire ne se traite pas comme un salarié en paye. */
        contract_type varchar(24) NOT NULL DEFAULT 'salarie'
                        CHECK (contract_type IN ('salarie', 'interimaire', 'apprenti')),
        active        boolean NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        deleted_at    timestamptz NULL,
        UNIQUE (tenant_id, code)
      );
    `);
    await this.enableRls(queryRunner, 'employee');

    // Le pointage référence la fiche ; NULL reste permis pour les saisies antérieures.
    await queryRunner.query(
      `ALTER TABLE timesheet ADD COLUMN employee_id uuid NULL REFERENCES employee(id) ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_timesheet_employee ON timesheet(employee_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_timesheet_employee;`);
    await queryRunner.query(`ALTER TABLE timesheet DROP COLUMN IF EXISTS employee_id;`);
    await queryRunner.query(`DROP TABLE IF EXISTS employee;`);
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
