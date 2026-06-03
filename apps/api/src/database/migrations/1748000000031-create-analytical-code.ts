import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plan analytique à 5 niveaux (cahier des charges §5.8) — refactor C.1 (schéma).
 *
 * Insère le niveau « code analytique » (n° société, ex. COLLE=280) entre la famille et la
 * ressource : nature → lot → famille → CODE ANALYTIQUE → ressource. Un code analytique regroupe
 * N ressources ; une ressource appartient à exactement un code analytique et porte un
 * `code_produit` unique par société.
 *
 * Additif et non destructif : nouvelles colonnes NULLABLE, backfill des données existantes
 * (un code « (à classer) » par famille, ressources repointées), `famille_analytique_id` conservé
 * transitoirement (retiré en C.4 une fois les services basculés). Les contraintes NOT NULL seront
 * posées plus tard. Tenant-scoped (RLS).
 */
export class CreateAnalyticalCode1748000000031 implements MigrationInterface {
  name = 'CreateAnalyticalCode1748000000031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Niveau 4 : code analytique (→ famille), référence partagée par société ---
    await queryRunner.query(`
      CREATE TABLE analytical_code (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        company_id  uuid NULL REFERENCES company(id) ON DELETE CASCADE,
        famille_id  uuid NOT NULL REFERENCES analytical_famille(id) ON DELETE CASCADE,
        code        varchar(64) NOT NULL,
        label       varchar(255) NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, code)
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_analytical_code_famille ON analytical_code(famille_id);`);
    await queryRunner.query(`ALTER TABLE analytical_code ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE analytical_code FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY analytical_code_tenant_isolation ON analytical_code
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);

    // --- Ressource : code produit (unique société) + rattachement à un code analytique ---
    await queryRunner.query(`ALTER TABLE resource ADD COLUMN code_produit varchar(64) NULL;`);
    await queryRunner.query(
      `ALTER TABLE resource ADD COLUMN code_analytique_id uuid NULL REFERENCES analytical_code(id) ON DELETE SET NULL;`,
    );
    await queryRunner.query(`CREATE INDEX idx_resource_code_analytique ON resource(code_analytique_id);`);

    // Backfill code_produit depuis l'ancien `code`, dédoublonné par société (collisions inter-bibliothèques).
    await queryRunner.query(`UPDATE resource SET code_produit = code;`);
    await queryRunner.query(`
      WITH d AS (
        SELECT id, row_number() OVER (
                 PARTITION BY tenant_id, code_produit ORDER BY created_at, id) AS rn
          FROM resource
      )
      UPDATE resource r SET code_produit = r.code_produit || '-' || d.rn
        FROM d WHERE d.id = r.id AND d.rn > 1;
    `);
    await queryRunner.query(
      `ALTER TABLE resource ADD CONSTRAINT resource_tenant_code_produit_key UNIQUE (tenant_id, code_produit);`,
    );

    // Backfill code analytique : un code « (à classer) » par famille ayant des ressources, repointage.
    await queryRunner.query(`
      INSERT INTO analytical_code (tenant_id, famille_id, code, label)
      SELECT DISTINCT f.tenant_id, f.id, 'ACL-CODE-' || f.code, 'À classer'
      FROM analytical_famille f
      WHERE EXISTS (SELECT 1 FROM resource r WHERE r.famille_analytique_id = f.id);
    `);
    await queryRunner.query(`
      UPDATE resource r SET code_analytique_id = c.id
      FROM analytical_code c, analytical_famille f
      WHERE f.id = r.famille_analytique_id
        AND c.famille_id = f.id
        AND c.code = 'ACL-CODE-' || f.code;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE resource DROP CONSTRAINT IF EXISTS resource_tenant_code_produit_key;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_resource_code_analytique;`);
    await queryRunner.query(`ALTER TABLE resource DROP COLUMN IF EXISTS code_analytique_id;`);
    await queryRunner.query(`ALTER TABLE resource DROP COLUMN IF EXISTS code_produit;`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytical_code;`);
  }
}
