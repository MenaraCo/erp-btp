import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rôle système « Direction (lecture) » pour les sociétés DÉJÀ en base.
 *
 * `provisionSystemRoles` réconcilie les rôles depuis `rbac.config.ts`, mais il n'est appelé qu'à
 * l'inscription d'une société. Ajouter un rôle au catalogue ne suffit donc pas : sans ce
 * rattrapage, seules les sociétés créées APRÈS la mise à jour l'auraient, et les clients existants
 * resteraient coincés avec « Administrateur ou rien » pour surveiller leur activité.
 *
 * Idempotent (ON CONFLICT) et aligné mot pour mot sur la définition du catalogue : lecture du
 * référentiel, des devis, de la facturation, des chantiers et du financier — aucune écriture.
 */
export class RoleDirection1748000000078 implements MigrationInterface {
  name = 'RoleDirection1748000000078';

  private static readonly PERMISSIONS = [
    'directory.read',
    'estimating.devis.read',
    'invoicing.read',
    'site_tracking.read',
    'financial.read',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Un rôle par société existante. `is_system` = true : il se recompose depuis la configuration,
    // on ne le modifie pas à la main.
    await queryRunner.query(`
      INSERT INTO role (tenant_id, code, label, is_system)
      SELECT t.id, 'direction', 'Direction (lecture)', true
        FROM tenant t
      ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, updated_at = now();
    `);

    // Les permissions du rôle, prises dans le catalogue global. Le produit cartésien reste borné
    // (nb sociétés × 5) et ON CONFLICT rend la migration rejouable sans doublon.
    await queryRunner.query(
      `
      INSERT INTO role_permission (tenant_id, role_id, permission_id)
      SELECT r.tenant_id, r.id, p.id
        FROM role r
        JOIN permission p ON p.key = ANY($1)
       WHERE r.code = 'direction'
      ON CONFLICT (role_id, permission_id) DO NOTHING;
    `,
      [RoleDirection1748000000078.PERMISSIONS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // On retire le rôle et ses affectations (user_role part en cascade sur role.id). Aucune donnée
    // métier n'en dépend : les personnes concernées retombent sur leurs autres rôles.
    await queryRunner.query(`DELETE FROM role WHERE code = 'direction' AND is_system = true;`);
  }
}
