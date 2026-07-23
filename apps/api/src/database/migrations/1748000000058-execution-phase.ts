import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cycle de vie du suivi d'exécution d'un marché (cahier des charges §5.5).
 *
 * Le suivi passe par trois phases explicites, chacune validée et horodatée :
 *   1. `etude`        — le budget d'étude (déboursé copié au transfert) est en lecture ; on le VALIDE.
 *   2. `contre_etude` — on renégocie ratios / quantités / PU et on modifie les prestations
 *                       (ajout / suppression d'ouvrages, ressources propres au chantier) ; on VALIDE,
 *                       ce qui fige le budget objectif comme référence et initialise le prévisionnel.
 *   3. `execution`    — tout au long du chantier (avancement, dépenses).
 *
 * `contre_etude_status` (draft/validated) est CONSERVÉ pour la réversibilité ; le code n'utilise
 * plus que `execution_phase`. Reprise : draft → contre_etude (déjà éditable), validated → execution.
 *
 * `execution_change_log` journalise (horodaté, avec l'auteur) chaque modification et validation de
 * phase — « tout doit être horodaté ». Table tenant-scopée (RLS).
 */
export class ExecutionPhase1748000000058 implements MigrationInterface {
  name = 'ExecutionPhase1748000000058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE marche
        ADD COLUMN execution_phase varchar(16) NOT NULL DEFAULT 'etude'
          CHECK (execution_phase IN ('etude', 'contre_etude', 'execution')),
        ADD COLUMN etude_validated_at timestamptz NULL,
        ADD COLUMN contre_etude_validated_at timestamptz NULL;
    `);

    // Reprise des marchés existants depuis l'ancien statut à 2 états.
    await queryRunner.query(`
      UPDATE marche SET
        execution_phase = CASE
          WHEN contre_etude_status = 'validated' THEN 'execution'
          ELSE 'contre_etude'
        END,
        contre_etude_validated_at = CASE
          WHEN contre_etude_status = 'validated' THEN COALESCE(updated_at, now())
          ELSE NULL
        END;
    `);

    await queryRunner.query(`
      CREATE TABLE execution_change_log (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        marche_id         uuid NOT NULL REFERENCES marche(id) ON DELETE CASCADE,
        execution_line_id uuid NULL REFERENCES execution_line(id) ON DELETE SET NULL,
        actor_user_id     uuid NULL,
        action            varchar(48) NOT NULL,
        detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at        timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_execution_change_log_marche ON execution_change_log(marche_id, created_at DESC);`,
    );
    await queryRunner.query(`ALTER TABLE execution_change_log ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE execution_change_log FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY execution_change_log_tenant_isolation ON execution_change_log
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS execution_change_log;`);
    await queryRunner.query(`
      ALTER TABLE marche
        DROP COLUMN IF EXISTS execution_phase,
        DROP COLUMN IF EXISTS etude_validated_at,
        DROP COLUMN IF EXISTS contre_etude_validated_at;
    `);
  }
}
