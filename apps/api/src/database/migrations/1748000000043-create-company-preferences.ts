import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Préférences société pour le menu Paramètres (cahier des charges §3.7 + §5.1).
 *
 * company_preferences : one row per company (1-1 with company).
 * Contient :
 *  - infos légales étendues (adresse, forme juridique, SIRET, TVA, RCS, capital, téléphone, email)
 *  - responsable de l'affaire (nom, téléphone, email) — apparaît sur les PDFs
 *  - taux par défaut FG et bénéfice (pré-remplis à la création d'un devis, modifiables par devis)
 *  - numérotation des devis (préfixe, séparateur)
 *  - couleur principale (app + PDF)
 */
export class CreateCompanyPreferences1748000000043 implements MigrationInterface {
  name = 'CreateCompanyPreferences1748000000043';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /* Extension de la table company : infos légales manquantes */
    await queryRunner.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS address      text NULL;`);
    await queryRunner.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS postal_code  varchar(16) NULL;`);
    await queryRunner.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS city         varchar(128) NULL;`);
    await queryRunner.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS phone        varchar(32) NULL;`);
    await queryRunner.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS email        varchar(255) NULL;`);
    await queryRunner.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS legal_form   varchar(64) NULL;`);
    await queryRunner.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS siret        varchar(32) NULL;`);
    await queryRunner.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS vat_intra    varchar(32) NULL;`);
    await queryRunner.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS rcs          varchar(64) NULL;`);
    await queryRunner.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS capital      varchar(64) NULL;`);

    /* Préférences d'étude + présentation */
    await queryRunner.query(`
      CREATE TABLE company_preferences (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id           uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        company_id          uuid NOT NULL UNIQUE REFERENCES company(id) ON DELETE CASCADE,

        /* Responsable apparaissant sur les PDFs */
        resp_nom            varchar(128) NULL,
        resp_telephone      varchar(32)  NULL,
        resp_email          varchar(255) NULL,

        /* Taux par défaut FG / bénéfice (en %, ex. 25 / 15) */
        taux_fg_default     numeric(8,2) NOT NULL DEFAULT 25,
        taux_ben_default    numeric(8,2) NOT NULL DEFAULT 15,

        /* Numérotation des devis */
        devis_prefix        varchar(16)  NOT NULL DEFAULT 'DEV',
        devis_separator     varchar(4)   NOT NULL DEFAULT '-',

        /* Couleur principale app + PDF (hex) */
        couleur_principale  varchar(16)  NOT NULL DEFAULT '#1a3a5c',

        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`ALTER TABLE company_preferences ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE company_preferences FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY company_pref_tenant_isolation ON company_preferences
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);

    /* Pré-seed pour le tenant demo / première société */
    await queryRunner.query(`
      INSERT INTO company_preferences (tenant_id, company_id)
      SELECT c.tenant_id, c.id
      FROM company c
      ON CONFLICT (company_id) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS company_preferences;`);
    await queryRunner.query(`ALTER TABLE company DROP COLUMN IF EXISTS capital;`);
    await queryRunner.query(`ALTER TABLE company DROP COLUMN IF EXISTS rcs;`);
    await queryRunner.query(`ALTER TABLE company DROP COLUMN IF EXISTS vat_intra;`);
    await queryRunner.query(`ALTER TABLE company DROP COLUMN IF EXISTS siret;`);
    await queryRunner.query(`ALTER TABLE company DROP COLUMN IF EXISTS legal_form;`);
    await queryRunner.query(`ALTER TABLE company DROP COLUMN IF EXISTS email;`);
    await queryRunner.query(`ALTER TABLE company DROP COLUMN IF EXISTS phone;`);
    await queryRunner.query(`ALTER TABLE company DROP COLUMN IF EXISTS city;`);
    await queryRunner.query(`ALTER TABLE company DROP COLUMN IF EXISTS postal_code;`);
    await queryRunner.query(`ALTER TABLE company DROP COLUMN IF EXISTS address;`);
  }
}
