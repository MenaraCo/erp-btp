import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fonction d'annuaire pour l'écran de connexion : à partir d'un e-mail, lister les sociétés
 * (slug + nom) auxquelles il est rattaché, afin que l'utilisateur CHOISISSE sa société dans une
 * liste plutôt que de retaper un nom/slug (cause du bug « connexion impossible après inscription »).
 *
 * `user_account` est en RLS FORCÉE : une lecture inter-tenants est normalement impossible. On
 * expose donc une fonction `SECURITY DEFINER`, exécutée avec les droits du propriétaire (qui
 * contourne la RLS), qui ne renvoie QUE `slug` + `name` — jamais de colonne sensible (mot de passe,
 * secret 2FA…). Le contrôle du mot de passe à l'étape suivante reste le vrai garde-fou : lister
 * l'existence d'un e-mail est un compromis UX assumé (atténuable par du rate-limiting plus tard).
 *
 * `STABLE` : pas d'effet de bord. Droit d'exécution laissé à PUBLIC (défaut) — la fonction est
 * volontairement inoffensive.
 */
export class CompaniesForEmail1748000000085 implements MigrationInterface {
  name = 'CompaniesForEmail1748000000085';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION companies_for_email(p_email text)
        RETURNS TABLE(slug text, name text)
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public
      AS $$
        SELECT t.slug, t.name
          FROM user_account u
          JOIN tenant t ON t.id = u.tenant_id
         WHERE lower(u.email) = lower(p_email)
           AND u.status = 'active'
         ORDER BY t.name;
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS companies_for_email(text);`);
  }
}
