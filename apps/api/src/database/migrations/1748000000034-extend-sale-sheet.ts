import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Feuille de vente — extension (cahier des charges §5.2):
 *  - sale_sheet.coefficients passe de { nature: coeff } à { nature: { tauxFg, tauxBenefice } } :
 *    FG (frais généraux) et Bénéfice séparés par nature, pour exposer un prix de revient distinct
 *    et des marges brute vs nette. Conversion conservatrice : coeff → FG=(coeff−1)×100, Bénéfice=0
 *    (le PV calculé est inchangé).
 *  - remise globale (type pct|fixe + valeur) au niveau de la feuille.
 *  - devis_frais_annexe : liste de postes nommés (% du PV hors frais ou montant fixe).
 *  - devis_line : nature saisie à la main (valorise les lignes manuelles/ressource) + pu_vente /
 *    pu_vente_force pour un vrai PV forcé distinct du déboursé (pu).
 * Tenant-scoped (RLS). frais_coefficient est conservé (déprécié) pour ne rien perdre.
 */
export class ExtendSaleSheet1748000000034 implements MigrationInterface {
  name = 'ExtendSaleSheet1748000000034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. devis_line : nature manuelle + PV forcé
    await queryRunner.query(`
      ALTER TABLE devis_line
        ADD COLUMN nature varchar(16) NULL
          CHECK (nature IN ('labor', 'material', 'equipment', 'subcontract')),
        ADD COLUMN pu_vente numeric(14,4) NULL,
        ADD COLUMN pu_vente_force boolean NOT NULL DEFAULT false;
    `);

    // 2. sale_sheet : remise + conversion des coefficients vers { tauxFg, tauxBenefice }
    await queryRunner.query(`
      ALTER TABLE sale_sheet
        ADD COLUMN remise_type varchar(8) NOT NULL DEFAULT 'pct'
          CHECK (remise_type IN ('pct', 'fixe')),
        ADD COLUMN remise_valeur numeric(14,4) NOT NULL DEFAULT 0;
    `);
    await queryRunner.query(`
      UPDATE sale_sheet SET coefficients = (
        SELECT jsonb_object_agg(
          key,
          jsonb_build_object('tauxFg', (value::numeric - 1) * 100, 'tauxBenefice', 0)
        )
        FROM jsonb_each_text(coefficients)
      )
      WHERE jsonb_typeof(coefficients -> 'material') <> 'object';
    `);

    // 3. devis_frais_annexe : postes additionnels du devis
    await queryRunner.query(`
      CREATE TABLE devis_frais_annexe (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        affaire_version_id uuid NOT NULL REFERENCES affaire_version(id) ON DELETE CASCADE,
        designation        varchar(255) NOT NULL,
        type               varchar(8) NOT NULL CHECK (type IN ('pct', 'fixe')),
        valeur             numeric(14,4) NOT NULL DEFAULT 0,
        sort_order         integer NOT NULL DEFAULT 0,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_devis_frais_annexe_version ON devis_frais_annexe(affaire_version_id);`,
    );
    await queryRunner.query(`ALTER TABLE devis_frais_annexe ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE devis_frais_annexe FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY devis_frais_annexe_tenant_isolation ON devis_frais_annexe
        USING (tenant_id = current_tenant())
        WITH CHECK (tenant_id = current_tenant());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS devis_frais_annexe;`);

    // Revert coefficients to the single-multiplier shape (best effort: Bénéfice is dropped).
    await queryRunner.query(`
      UPDATE sale_sheet SET coefficients = (
        SELECT jsonb_object_agg(
          key,
          to_jsonb(
            round(
              (1 + (value -> 'tauxFg')::numeric / 100)
              * (1 + (value -> 'tauxBenefice')::numeric / 100),
              6
            )
          )
        )
        FROM jsonb_each(coefficients)
      )
      WHERE jsonb_typeof(coefficients -> 'material') = 'object';
    `);
    await queryRunner.query(`
      ALTER TABLE sale_sheet
        DROP COLUMN IF EXISTS remise_type,
        DROP COLUMN IF EXISTS remise_valeur;
    `);
    await queryRunner.query(`
      ALTER TABLE devis_line
        DROP COLUMN IF EXISTS nature,
        DROP COLUMN IF EXISTS pu_vente,
        DROP COLUMN IF EXISTS pu_vente_force;
    `);
  }
}
