import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repackaging commercial : l'offre passe d'une vente **module par module** à une vente en
 * **paliers** (Essentiel → Pro → Pro Chantier → Pro Max), les add-ons restant à la carte
 * par-dessus un palier.
 *
 * Rien ne change pour le moteur de droits : la souscription continue d'être projetée sur
 * `tenant_module` / `seat_assignment`, donc la garde de capacité et ses tests sont intacts
 * (cahier §3.1 : « paliers, modules ou packs ne sont qu'un découpage de packaging »).
 *
 *  - `pack.price_monthly` / `pack.tier_level` : prix du palier et son rang.
 *  - `module.min_tier_level` : palier minimum requis pour souscrire un add-on
 *    (ex. l'Assistance IA exige au moins Pro Chantier). NULL = pas de contrainte.
 *  - `subscription.pack_code` / `pack_seats` : le palier souscrit et ses jetons. Les jetons
 *    portent sur le pack : un utilisateur qui en reçoit un accède à tous les modules du palier.
 *
 * Reprise de l'existant : les abonnés vendus à la carte sont rattachés au palier le plus petit
 * qui couvre déjà tous leurs modules actifs — aucune perte de fonctionnalité, aucun accès gagné.
 */
export class PackTiers1748000000056 implements MigrationInterface {
  name = 'PackTiers1748000000056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pack
        ADD COLUMN price_monthly numeric(10,2) NULL,
        ADD COLUMN tier_level    integer NOT NULL DEFAULT 1;
    `);
    await queryRunner.query(`
      ALTER TABLE module ADD COLUMN min_tier_level integer NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE subscription
        ADD COLUMN pack_code  varchar(64) NULL REFERENCES pack(code),
        ADD COLUMN pack_seats integer NOT NULL DEFAULT 0;
    `);

    // Les paliers doivent exister avant la reprise (clé étrangère subscription.pack_code).
    // Le seed les réconciliera ensuite avec la configuration.
    await queryRunner.query(`
      INSERT INTO pack (code, label, discount_pct, active, price_monthly, tier_level) VALUES
        ('essentiel',    'Essentiel',    0, true,  39, 1),
        ('pro',          'Pro',          0, true,  59, 2),
        ('pro_chantier', 'Pro Chantier', 0, true,  89, 3),
        ('pro_max',      'Pro Max',      0, true, 129, 4)
      ON CONFLICT (code) DO UPDATE
        SET price_monthly = EXCLUDED.price_monthly,
            tier_level    = EXCLUDED.tier_level,
            updated_at    = now();
    `);

    // Reprise des abonnés existants : chaque souscription est rattachée au plus petit palier
    // couvrant déjà tous ses modules actifs.
    await queryRunner.query(`
      WITH actifs AS (
        SELECT tenant_id, array_agg(module_code ORDER BY module_code) AS codes,
               max(seats_purchased) AS seats
          FROM tenant_module
         WHERE active = true
         GROUP BY tenant_id
      ),
      cible AS (
        SELECT a.tenant_id,
               a.seats,
               CASE
                 WHEN 'financial_management' = ANY(a.codes) THEN 'pro_max'
                 WHEN 'site_tracking'        = ANY(a.codes) THEN 'pro_chantier'
                 WHEN 'invoicing'            = ANY(a.codes) THEN 'pro'
                 ELSE 'essentiel'
               END AS pack_code
          FROM actifs a
      )
      UPDATE subscription s
         SET pack_code  = c.pack_code,
             pack_seats = GREATEST(c.seats, 1),
             updated_at = now()
        FROM cible c
       WHERE s.tenant_id = c.tenant_id
         AND s.pack_code IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE subscription
        DROP COLUMN IF EXISTS pack_seats,
        DROP COLUMN IF EXISTS pack_code;
    `);
    await queryRunner.query(`ALTER TABLE module DROP COLUMN IF EXISTS min_tier_level;`);
    await queryRunner.query(`
      ALTER TABLE pack
        DROP COLUMN IF EXISTS tier_level,
        DROP COLUMN IF EXISTS price_monthly;
    `);
  }
}
