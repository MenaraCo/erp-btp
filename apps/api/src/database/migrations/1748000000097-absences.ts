import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Congés et absences — le pendant indispensable du planning.
 *
 * Sans elles, un planning ment : il montre un salarié disponible alors qu'il est en congés, et
 * rien ne signale qu'on vient de le poser sur un chantier ce jour-là. Une absence n'est pas une
 * ligne de pointage — elle ne coûte rien à un chantier et n'entre dans aucun résultat — d'où sa
 * table à part, plutôt qu'un « chantier CONGÉS » qui polluerait l'analytique.
 *
 * Le créneau est facultatif, comme pour les heures : une demi-journée de récupération se saisit
 * de 8:00 à 12:00, un congé se pose sur la journée entière.
 */
export class Absences1748000000097 implements MigrationInterface {
  name = 'Absences1748000000097';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE absence (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        employee_id  uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
        work_date    date NOT NULL,
        kind         varchar(24) NOT NULL,
        hours        numeric(10,2) NOT NULL DEFAULT 7,
        start_time   time NULL,
        end_time     time NULL,
        comment      text NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT absence_kind_connu CHECK (kind IN (
          'conges', 'rtt', 'maladie', 'accident', 'intemperie',
          'formation', 'ferie', 'sans_solde', 'autre'
        )),
        CONSTRAINT absence_heures_positives CHECK (hours >= 0),
        -- Même règle que pour les heures : un créneau se donne en entier, ou pas du tout.
        CONSTRAINT absence_creneau_complet CHECK (
          (start_time IS NULL AND end_time IS NULL)
          OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
        ),
        -- Deux congés le même jour pour la même personne n'ont pas de sens ; une demi-journée de
        -- maladie ET une demi-journée de formation, si.
        UNIQUE (employee_id, work_date, kind)
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_absence_periode ON absence(work_date, employee_id);`);
    await queryRunner.query(`ALTER TABLE absence ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE absence FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY absence_tenant_isolation ON absence
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS absence;`);
  }
}
