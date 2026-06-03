import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rattachement ressource → famille analytique (cahier des charges §5.8) — increment B.0b.
 *
 * "La ressource du chiffrage EST le code analytique" : a resource now points at a famille
 * (→ lot → nature), so its analytical position is intrinsic — no separate imputation field.
 *
 * The column is NULLABLE (a tenant classifies at its own pace). Non-destructive backfill:
 * existing resources are attached to an auto-created "(à classer)" lot + famille per nature so
 * nothing is lost and aggregation always has a bucket. Run by the migration owner, which
 * bypasses RLS, so the set-based backfill keyed on tenant_id is safe.
 */
export class LinkResourceFamille1748000000027 implements MigrationInterface {
  name = 'LinkResourceFamille1748000000027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE resource
        ADD COLUMN famille_analytique_id uuid NULL REFERENCES analytical_famille(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(
      `CREATE INDEX idx_resource_famille ON resource(famille_analytique_id);`,
    );

    // 1) one "(à classer)" lot per (tenant, nature) that has unclassified resources
    await queryRunner.query(`
      INSERT INTO analytical_lot (tenant_id, nature, code, label)
      SELECT DISTINCT r.tenant_id, r.nature, 'ACL-' || r.nature,
             'À classer — ' || CASE r.nature
               WHEN 'material' THEN 'Matériaux'
               WHEN 'equipment' THEN 'Matériel'
               WHEN 'subcontract' THEN 'Sous-traitance'
               WHEN 'labor' THEN 'Main d''œuvre'
               ELSE r.nature END
      FROM resource r
      WHERE r.famille_analytique_id IS NULL
      ON CONFLICT (tenant_id, code) DO NOTHING;
    `);

    // 2) one "(à classer)" famille under each of those lots
    await queryRunner.query(`
      INSERT INTO analytical_famille (tenant_id, lot_id, code, label)
      SELECT l.tenant_id, l.id, 'ACL-' || l.nature || '-F', 'À classer'
      FROM analytical_lot l
      WHERE l.code = 'ACL-' || l.nature
      ON CONFLICT (tenant_id, code) DO NOTHING;
    `);

    // 3) attach unclassified resources to their nature's "(à classer)" famille
    await queryRunner.query(`
      UPDATE resource r
      SET famille_analytique_id = f.id
      FROM analytical_famille f
      JOIN analytical_lot l ON l.id = f.lot_id
      WHERE r.famille_analytique_id IS NULL
        AND l.tenant_id = r.tenant_id
        AND l.nature = r.nature
        AND f.code = 'ACL-' || l.nature || '-F';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Non-destructive of user data: only drop the link column. The "(à classer)" classification
    // rows are left in analytical_lot/famille (harmless) and re-created idempotently on re-run.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_resource_famille;`);
    await queryRunner.query(`ALTER TABLE resource DROP COLUMN IF EXISTS famille_analytique_id;`);
  }
}
