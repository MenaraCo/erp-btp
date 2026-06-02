import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Feuille de vente (cahier des charges §5.2): per-version sale coefficients (by nature),
 * frais coefficient and TVA rate. Adds a `vendable` flag on devis_line so titres non vendables
 * (frais de chantier) can be ventilated. Tenant-scoped (RLS).
 */
export class CreateSaleSheet1748000000013 implements MigrationInterface {
  name = 'CreateSaleSheet1748000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE devis_line ADD COLUMN vendable boolean NOT NULL DEFAULT true;`,
    );

    await queryRunner.query(`
      CREATE TABLE sale_sheet (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        affaire_version_id uuid NOT NULL UNIQUE REFERENCES affaire_version(id) ON DELETE CASCADE,
        coefficients       jsonb NOT NULL,
        frais_coefficient  numeric(9,6) NOT NULL DEFAULT 1,
        tva_rate           numeric(6,4) NOT NULL DEFAULT 0.20,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`ALTER TABLE sale_sheet ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE sale_sheet FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY sale_sheet_tenant_isolation ON sale_sheet
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sale_sheet;`);
    await queryRunner.query(`ALTER TABLE devis_line DROP COLUMN IF EXISTS vendable;`);
  }
}
