import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * L'AVANCEMENT PRÉVU : ce qu'on compte réaliser sur la période à venir (guide §19).
 *
 * Le constaté regarde derrière : ce qui est fait. Le prévu regarde devant, et sert à autre chose —
 * il quantifie les BESOINS de la période : combien d'heures de main-d'œuvre, quels matériaux à
 * commander, pour quel montant. Sans lui, l'approvisionnement se fait au jugé et le conducteur
 * découvre en fin de mois qu'il a commandé pour deux fois la période.
 *
 * Une prévision se rattache donc à une PÉRIODE (celle qui commence) et vit à côté du constat, sans
 * jamais s'y substituer : on doit pouvoir comparer ce qu'on avait prévu à ce qui s'est fait.
 */
export class AvancementPrevu1748000000121 implements MigrationInterface {
  name = 'AvancementPrevu1748000000121';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE execution_line_prevu (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id       uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        execution_line_id uuid NOT NULL REFERENCES execution_line(id) ON DELETE CASCADE,
        /* Fraction 0..1 de l'ouvrage prévue sur la période. */
        pct               numeric(6,5) NOT NULL,
        periode_debut     date NOT NULL,
        periode_fin       date NOT NULL,
        recorded_at       timestamptz NOT NULL DEFAULT now(),
        actor_user_id     uuid NULL,
        CONSTRAINT periode_prevu_coherente CHECK (periode_fin >= periode_debut)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_prevu_ligne ON execution_line_prevu(execution_line_id, recorded_at DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_prevu_chantier ON execution_line_prevu(chantier_id, periode_debut);`,
    );
    await queryRunner.query(`ALTER TABLE execution_line_prevu ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE execution_line_prevu FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY execution_line_prevu_tenant_isolation ON execution_line_prevu
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS execution_line_prevu;`);
  }
}
