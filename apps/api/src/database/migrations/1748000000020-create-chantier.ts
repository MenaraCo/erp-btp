import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suivi de chantiers (cahier des charges §5.4/§5.5) — increment 3.1: a chantier created from a
 * won affaire, holding an étude d'exécution (copied from the déboursé) with a per-nature budget.
 * Two budget snapshots per line: étude (frozen) and objectif (contre-étude, editable in 3.2).
 * Tenant-scoped (RLS).
 */
export class CreateChantier1748000000020 implements MigrationInterface {
  name = 'CreateChantier1748000000020';

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
      CREATE TABLE chantier (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id           uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        code                varchar(64) NOT NULL,
        name                varchar(255) NOT NULL,
        affaire_id          uuid NULL REFERENCES affaire(id) ON DELETE SET NULL,
        affaire_version_id  uuid NULL UNIQUE REFERENCES affaire_version(id) ON DELETE SET NULL,
        marche_id           uuid NULL REFERENCES marche(id) ON DELETE SET NULL,
        execution_form      varchar(24) NOT NULL DEFAULT 'by_ouvrage',
        budget_vente_ht     numeric(16,2) NOT NULL DEFAULT 0,
        contre_etude_status varchar(16) NOT NULL DEFAULT 'draft',
        status              varchar(32) NOT NULL DEFAULT 'open',
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now(),
        deleted_at          timestamptz NULL,
        UNIQUE (tenant_id, code)
      );
    `);
    await this.enableRls(queryRunner, 'chantier');

    await queryRunner.query(`
      CREATE TABLE execution_line (
        id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id                   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        chantier_id                 uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        parent_line_id              uuid NULL REFERENCES execution_line(id) ON DELETE CASCADE,
        type                        varchar(16) NOT NULL CHECK (type IN ('titre', 'ouvrage')),
        code                        varchar(64) NULL,
        designation                 varchar(500) NOT NULL,
        unit                        varchar(16) NULL,
        source_devis_line_id        uuid NULL,
        source_ouvrage_id           uuid NULL,
        quantite_etude              numeric(16,4) NOT NULL DEFAULT 0,
        quantite_objectif          numeric(16,4) NOT NULL DEFAULT 0,
        debourse_unitaire_etude     numeric(14,4) NOT NULL DEFAULT 0,
        debourse_unitaire_objectif  numeric(14,4) NOT NULL DEFAULT 0,
        sort_order                  integer NOT NULL DEFAULT 0,
        created_at                  timestamptz NOT NULL DEFAULT now(),
        updated_at                  timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_execution_line_chantier ON execution_line(chantier_id);`,
    );
    await this.enableRls(queryRunner, 'execution_line');

    await queryRunner.query(`
      CREATE TABLE execution_line_budget (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        execution_line_id  uuid NOT NULL REFERENCES execution_line(id) ON DELETE CASCADE,
        nature             varchar(16) NOT NULL
                             CHECK (nature IN ('labor','material','equipment','subcontract','site_overhead')),
        montant_etude      numeric(16,2) NOT NULL DEFAULT 0,
        montant_objectif   numeric(16,2) NOT NULL DEFAULT 0,
        UNIQUE (execution_line_id, nature)
      );
    `);
    await this.enableRls(queryRunner, 'execution_line_budget');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS execution_line_budget;`);
    await queryRunner.query(`DROP TABLE IF EXISTS execution_line;`);
    await queryRunner.query(`DROP TABLE IF EXISTS chantier;`);
  }
}
