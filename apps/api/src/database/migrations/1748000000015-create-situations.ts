import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Situations de travaux à l'avancement (cahier des charges §5.6, rule #6). Each situation
 * certifies a cumulative advancement of the marché lines; its period amount deducts prior
 * situations. Stores the computed pied (HT/TVA/TTC, retenue de garantie, NAP). Tenant-scoped (RLS).
 */
export class CreateSituations1748000000015 implements MigrationInterface {
  name = 'CreateSituations1748000000015';

  private async enableRls(qr: QueryRunner, table: string): Promise<void> {
    await qr.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    await qr.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    await qr.query(`
      CREATE POLICY ${table}_tenant_isolation ON ${table}
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE situation (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id            uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        marche_id            uuid NOT NULL REFERENCES marche(id) ON DELETE CASCADE,
        numero               integer NOT NULL,
        date                 date NOT NULL DEFAULT now(),
        status               varchar(32) NOT NULL DEFAULT 'draft',
        revision_coefficient numeric(9,6) NOT NULL DEFAULT 1,
        retenue_rate         numeric(6,4) NOT NULL DEFAULT 0.05,
        tva_rate             numeric(6,4) NOT NULL DEFAULT 0.20,
        cumul_ht             numeric(16,2) NOT NULL DEFAULT 0,
        montant_periode_ht   numeric(16,2) NOT NULL DEFAULT 0,
        tva                  numeric(16,2) NOT NULL DEFAULT 0,
        ttc                  numeric(16,2) NOT NULL DEFAULT 0,
        retenue_garantie     numeric(16,2) NOT NULL DEFAULT 0,
        nap                  numeric(16,2) NOT NULL DEFAULT 0,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now(),
        UNIQUE (marche_id, numero)
      );
    `);
    await this.enableRls(queryRunner, 'situation');

    await queryRunner.query(`
      CREATE TABLE situation_line (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        situation_id    uuid NOT NULL REFERENCES situation(id) ON DELETE CASCADE,
        marche_line_id  uuid NOT NULL REFERENCES marche_line(id) ON DELETE CASCADE,
        quantite        numeric(16,4) NOT NULL DEFAULT 0,
        pu              numeric(14,4) NOT NULL DEFAULT 0,
        pct_avancement  numeric(6,4) NOT NULL DEFAULT 0,
        cumul_ht        numeric(16,2) NOT NULL DEFAULT 0,
        created_at      timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_situation_line_situation ON situation_line(situation_id);`,
    );
    await this.enableRls(queryRunner, 'situation_line');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS situation_line;`);
    await queryRunner.query(`DROP TABLE IF EXISTS situation;`);
  }
}
