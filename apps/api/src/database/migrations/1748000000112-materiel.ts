import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Parc matériel : fiches d'engins, affectation aux chantiers, utilisation réelle.
 *
 * Le matériel coûte deux fois : à l'achat ou à la location, et à chaque heure d'usage (carburant,
 * usure, entretien). Le chantier, lui, ne doit payer que ce qu'il a utilisé — d'où un coût
 * d'utilisation porté par la fiche, et un relevé d'usage qui l'applique.
 *
 * Deux temps, comme pour la main-d'œuvre : l'AFFECTATION annonce qu'un engin est réservé à un
 * chantier sur une période (c'est de l'engagé), le RELEVÉ D'UTILISATION constate ce qui a servi
 * (c'est du réalisé). Sans cette séparation, on ne saurait jamais si une pelle immobilisée trois
 * semaines a réellement travaillé.
 */
export class Materiel1748000000112 implements MigrationInterface {
  name = 'Materiel1748000000112';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE equipment (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        code          varchar(64) NOT NULL,
        label         varchar(255) NOT NULL,
        type          varchar(24) NOT NULL DEFAULT 'engin'
                        CHECK (type IN ('engin', 'vehicule', 'outillage', 'autre')),
        /* Parc ou location : la question first posée quand un chantier réclame une machine. */
        propriete     varchar(16) NOT NULL DEFAULT 'parc'
                        CHECK (propriete IN ('parc', 'location')),
        supplier_id   uuid NULL REFERENCES supplier(id) ON DELETE SET NULL,
        marque        varchar(128) NULL,
        modele        varchar(128) NULL,
        immatriculation varchar(32) NULL,
        numero_serie  varchar(64) NULL,
        annee         int NULL,
        /* Coût d'utilisation imputé au chantier, à l'heure OU à la journée selon l'engin. */
        cout_unitaire numeric(14,4) NOT NULL DEFAULT 0,
        unite_cout    varchar(8) NOT NULL DEFAULT 'jour'
                        CHECK (unite_cout IN ('heure', 'jour')),
        code_analytique_id uuid NULL REFERENCES analytical_code(id) ON DELETE SET NULL,
        date_achat    date NULL,
        valeur_achat  numeric(16,2) NULL,
        /* Entretien : une révision ou un contrôle périmé cloue l'engin au dépôt. */
        date_prochaine_revision date NULL,
        date_controle_technique date NULL,
        date_assurance date NULL,
        actif         boolean NOT NULL DEFAULT true,
        commentaire   text NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        deleted_at    timestamptz NULL,
        UNIQUE (tenant_id, code)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE equipment_assignment (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        equipment_id uuid NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        chantier_id  uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        date_debut   date NOT NULL,
        date_fin     date NOT NULL,
        commentaire  text NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT affectation_periode_coherente CHECK (date_fin >= date_debut)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_affectation_materiel ON equipment_assignment(equipment_id, date_debut);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_affectation_chantier ON equipment_assignment(chantier_id);`,
    );

    await queryRunner.query(`
      CREATE TABLE equipment_usage (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        equipment_id uuid NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        chantier_id  uuid NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
        execution_line_id uuid NULL REFERENCES execution_line(id) ON DELETE SET NULL,
        work_date    date NOT NULL,
        /* Quantité dans l'unité de coût de l'engin : des heures, ou des journées. */
        quantite     numeric(10,2) NOT NULL DEFAULT 0,
        cout_unitaire numeric(14,4) NOT NULL DEFAULT 0,
        cout         numeric(16,2) NOT NULL DEFAULT 0,
        code_analytique_id uuid NULL REFERENCES analytical_code(id) ON DELETE SET NULL,
        commentaire  text NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT usage_quantite_positive CHECK (quantite >= 0)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_usage_materiel ON equipment_usage(equipment_id, work_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_usage_chantier ON equipment_usage(chantier_id, work_date);`,
    );

    for (const table of ['equipment', 'equipment_assignment', 'equipment_usage']) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`
        CREATE POLICY ${table}_tenant_isolation ON ${table}
          USING (tenant_id = current_tenant())
          WITH CHECK (tenant_id = current_tenant());
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS equipment_usage;`);
    await queryRunner.query(`DROP TABLE IF EXISTS equipment_assignment;`);
    await queryRunner.query(`DROP TABLE IF EXISTS equipment;`);
  }
}
