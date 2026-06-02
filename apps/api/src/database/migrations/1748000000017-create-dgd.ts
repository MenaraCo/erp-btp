import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DGD — Décompte Général Définitif (cahier des charges §5.6). One per marché, generated from the
 * last situation. Tenant-scoped (RLS).
 */
export class CreateDgd1748000000017 implements MigrationInterface {
  name = 'CreateDgd1748000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dgd (
        id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id                uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        marche_id                uuid NOT NULL UNIQUE REFERENCES marche(id) ON DELETE CASCADE,
        based_on_situation_id    uuid NULL REFERENCES situation(id) ON DELETE SET NULL,
        date                     date NOT NULL DEFAULT now(),
        status                   varchar(32) NOT NULL DEFAULT 'draft',
        montant_marche_ht        numeric(16,2) NOT NULL DEFAULT 0,
        travaux_cumul_ht         numeric(16,2) NOT NULL DEFAULT 0,
        tva                      numeric(16,2) NOT NULL DEFAULT 0,
        ttc                      numeric(16,2) NOT NULL DEFAULT 0,
        retenue_garantie_totale  numeric(16,2) NOT NULL DEFAULT 0,
        deja_regle_nap           numeric(16,2) NOT NULL DEFAULT 0,
        solde_nap                numeric(16,2) NOT NULL DEFAULT 0,
        created_at               timestamptz NOT NULL DEFAULT now(),
        updated_at               timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`ALTER TABLE dgd ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE dgd FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY dgd_tenant_isolation ON dgd
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS dgd;`);
  }
}
