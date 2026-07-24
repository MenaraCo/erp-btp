import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Avancement des budgets OUVRAGE PAR OUVRAGE (cahier des charges §5.8).
 *
 * En plus de l'avancement global / par nature (table chantier_advancement), le conducteur peut
 * renseigner l'avancement de chaque ouvrage (ligne d'exécution). Le dernier enregistrement par
 * ligne fait foi. Le moteur financier consomme un avancement global effectif = moyenne des
 * avancements de ligne PONDÉRÉE par le budget objectif de chaque ligne (soit exactement la somme
 * des budgets avancés ligne à ligne / budget total). Repli sur l'avancement global s'il n'y a
 * aucun avancement de ligne. Table tenant-scopée (RLS).
 */
export class LineAdvancement1748000000059 implements MigrationInterface {
  name = 'LineAdvancement1748000000059';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE execution_line_advancement (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id       uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        execution_line_id uuid NOT NULL REFERENCES execution_line(id) ON DELETE CASCADE,
        pct               numeric(6,5) NOT NULL,
        source            varchar(16) NOT NULL DEFAULT 'manual',
        recorded_at       timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_line_advancement_line ON execution_line_advancement(execution_line_id, recorded_at DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_line_advancement_chantier ON execution_line_advancement(chantier_id);`,
    );
    await queryRunner.query(`ALTER TABLE execution_line_advancement ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE execution_line_advancement FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY execution_line_advancement_tenant_isolation ON execution_line_advancement
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS execution_line_advancement;`);
  }
}
