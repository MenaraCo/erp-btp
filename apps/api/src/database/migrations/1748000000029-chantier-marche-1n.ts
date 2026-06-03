import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chantier 1→N Marché (CLAUDE.md + cahier des charges §5.4/5.5/5.6) — refactor step b.1 (schema).
 *
 * A chantier is the aggregation unit; it holds one or many marchés (one per won devis). The
 * étude d'exécution and its budget belong to the MARCHÉ (aggregated at the chantier). This step
 * is ADDITIVE and non-destructive: it adds the new links, relaxes the old 1:1 locks, and
 * backfills existing data (each current 1:1 chantier gets a wrapping "marché initial"). Column
 * removals on chantier are deferred to the final step once services no longer read them.
 */
export class ChantierMarche1n1748000000029 implements MigrationInterface {
  name = 'ChantierMarche1n1748000000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- marché now belongs to a chantier and carries its étude d'exécution metadata ---
    await queryRunner.query(
      `ALTER TABLE marche ADD COLUMN chantier_id uuid NULL REFERENCES chantier(id) ON DELETE CASCADE;`,
    );
    await queryRunner.query(
      `ALTER TABLE marche ADD COLUMN execution_form varchar(24) NOT NULL DEFAULT 'by_ouvrage';`,
    );
    await queryRunner.query(
      `ALTER TABLE marche ADD COLUMN contre_etude_status varchar(16) NOT NULL DEFAULT 'draft';`,
    );
    // relax the 1:1 locks: a chantier holds many marchés; a marché may exist without a version link
    await queryRunner.query(`ALTER TABLE marche ALTER COLUMN affaire_id DROP NOT NULL;`);
    await queryRunner.query(`ALTER TABLE marche ALTER COLUMN affaire_version_id DROP NOT NULL;`);
    await queryRunner.query(
      `ALTER TABLE marche DROP CONSTRAINT IF EXISTS marche_affaire_version_id_key;`,
    );
    await queryRunner.query(`CREATE INDEX idx_marche_chantier ON marche(chantier_id);`);

    // --- étude d'exécution scoped to the marché (chantier_id kept for aggregation) ---
    await queryRunner.query(
      `ALTER TABLE execution_line ADD COLUMN marche_id uuid NULL REFERENCES marche(id) ON DELETE CASCADE;`,
    );
    await queryRunner.query(
      `ALTER TABLE nomenclature_resource ADD COLUMN marche_id uuid NULL REFERENCES marche(id) ON DELETE CASCADE;`,
    );
    await queryRunner.query(`CREATE INDEX idx_execution_line_marche ON execution_line(marche_id);`);
    await queryRunner.query(
      `CREATE INDEX idx_nomenclature_marche ON nomenclature_resource(marche_id);`,
    );

    // chantier is no longer 1:1 with an affaire version
    await queryRunner.query(
      `ALTER TABLE chantier DROP CONSTRAINT IF EXISTS chantier_affaire_version_id_key;`,
    );

    // --- backfill: each existing chantier without a marché gets a wrapping "marché initial" ---
    await queryRunner.query(`
      INSERT INTO marche
        (tenant_id, affaire_id, affaire_version_id, chantier_id, code, name, total_ht,
         execution_form, contre_etude_status, status)
      SELECT c.tenant_id, c.affaire_id, c.affaire_version_id, c.id, c.code || '-M1', c.name,
             c.budget_vente_ht, c.execution_form, c.contre_etude_status, 'active'
      FROM chantier c
      WHERE NOT EXISTS (SELECT 1 FROM marche m WHERE m.chantier_id = c.id);
    `);
    await queryRunner.query(`
      UPDATE execution_line el SET marche_id = m.id
      FROM marche m WHERE m.chantier_id = el.chantier_id AND el.marche_id IS NULL;
    `);
    await queryRunner.query(`
      UPDATE nomenclature_resource nr SET marche_id = m.id
      FROM marche m WHERE m.chantier_id = nr.chantier_id AND nr.marche_id IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_nomenclature_marche;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_execution_line_marche;`);
    await queryRunner.query(
      `ALTER TABLE nomenclature_resource DROP COLUMN IF EXISTS marche_id;`,
    );
    await queryRunner.query(`ALTER TABLE execution_line DROP COLUMN IF EXISTS marche_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_marche_chantier;`);
    // remove backfilled marchés (those linked to a chantier) before tightening constraints back
    await queryRunner.query(`DELETE FROM marche WHERE chantier_id IS NOT NULL;`);
    await queryRunner.query(`ALTER TABLE marche DROP COLUMN IF EXISTS contre_etude_status;`);
    await queryRunner.query(`ALTER TABLE marche DROP COLUMN IF EXISTS execution_form;`);
    await queryRunner.query(`ALTER TABLE marche DROP COLUMN IF EXISTS chantier_id;`);
    await queryRunner.query(
      `ALTER TABLE marche ADD CONSTRAINT marche_affaire_version_id_key UNIQUE (affaire_version_id);`,
    );
    await queryRunner.query(
      `ALTER TABLE chantier ADD CONSTRAINT chantier_affaire_version_id_key UNIQUE (affaire_version_id);`,
    );
  }
}
