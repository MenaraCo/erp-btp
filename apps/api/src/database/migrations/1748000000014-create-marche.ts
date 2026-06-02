import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Acceptation de commande (cahier des charges §5.4): a won affaire is transferred into a
 * marché (the contract) with marché lines carrying the agreed quantity and unit sale price.
 * Codification stays coherent with the devis (rule #5). Tenant-scoped (RLS).
 * One marché per affaire version (UNIQUE) — prevents double transfer.
 */
export class CreateMarche1748000000014 implements MigrationInterface {
  name = 'CreateMarche1748000000014';

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
      CREATE TABLE marche (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        affaire_id         uuid NOT NULL REFERENCES affaire(id) ON DELETE CASCADE,
        affaire_version_id uuid NOT NULL UNIQUE REFERENCES affaire_version(id) ON DELETE CASCADE,
        code               varchar(64) NOT NULL,
        name               varchar(255) NOT NULL,
        status             varchar(32) NOT NULL DEFAULT 'active',
        total_ht           numeric(16,2) NOT NULL DEFAULT 0,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, code)
      );
    `);
    await this.enableRls(queryRunner, 'marche');

    await queryRunner.query(`
      CREATE TABLE marche_line (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id            uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        marche_id            uuid NOT NULL REFERENCES marche(id) ON DELETE CASCADE,
        code                 varchar(64) NULL,
        designation          varchar(500) NOT NULL,
        unit                 varchar(16) NULL,
        quantite             numeric(16,4) NOT NULL DEFAULT 0,
        pu                   numeric(14,4) NOT NULL DEFAULT 0,
        montant_ht           numeric(16,2) NOT NULL DEFAULT 0,
        source_devis_line_id uuid NULL,
        sort_order           integer NOT NULL DEFAULT 0,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_marche_line_marche ON marche_line(marche_id);`);
    await this.enableRls(queryRunner, 'marche_line');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS marche_line;`);
    await queryRunner.query(`DROP TABLE IF EXISTS marche;`);
  }
}
