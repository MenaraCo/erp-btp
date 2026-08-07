import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runInTenant } from '../tenancy/tenant-transaction';
import { SYSTEM_ROLES } from './rbac.config';

/**
 * Role-based access control. Roles are tenant-scoped and cumulable; permissions come from the
 * global catalogue. This is the second enforcement axis, orthogonal to entitlements.
 */
@Injectable()
export class RbacService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Creates/updates the system roles for a tenant from config (idempotent, reconciling). */
  provisionSystemRoles(tenantId: string): Promise<void> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      for (const def of SYSTEM_ROLES) {
        const roleRows = await em.query(
          `INSERT INTO role (tenant_id, code, label, is_system)
           VALUES ($1, $2, $3, true)
           ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, updated_at = now()
           RETURNING id`,
          [tenantId, def.code, def.label],
        );
        const roleId = roleRows[0].id;

        // Reconcile this role's permissions with config.
        await em.query(`DELETE FROM role_permission WHERE role_id = $1`, [roleId]);
        for (const key of def.permissions) {
          await em.query(
            `INSERT INTO role_permission (tenant_id, role_id, permission_id)
             SELECT $1, $2, p.id FROM permission p WHERE p.key = $3`,
            [tenantId, roleId, key],
          );
        }
      }
    });
  }

  /** All tenant roles with their granted permission keys (for the admin console). */
  listRoles(
    tenantId: string,
  ): Promise<Array<{ code: string; label: string; isSystem: boolean; permissions: string[] }>> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT r.code, r.label, r.is_system,
                COALESCE(ARRAY_AGG(p.key ORDER BY p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS permissions
           FROM role r
           LEFT JOIN role_permission rp ON rp.role_id = r.id
           LEFT JOIN permission p ON p.id = rp.permission_id
          GROUP BY r.id, r.code, r.label, r.is_system
          ORDER BY r.is_system DESC, r.label`,
      );
      return rows.map((r: { code: string; label: string; is_system: boolean; permissions: string[] }) => ({
        code: r.code,
        label: r.label,
        isSystem: r.is_system,
        permissions: r.permissions ?? [],
      }));
    });
  }

  /** Role codes currently held by a user. */
  listUserRoles(tenantId: string, userId: string): Promise<string[]> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT r.code FROM user_role ur JOIN role r ON r.id = ur.role_id
          WHERE ur.user_id = $1 ORDER BY r.code`,
        [userId],
      );
      return rows.map((r: { code: string }) => r.code);
    });
  }

  /** Removes a role (by code) from a user. */
  revokeRole(tenantId: string, userId: string, roleCode: string): Promise<void> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await em.query(
        `DELETE FROM user_role ur
          USING role r
          WHERE ur.role_id = r.id AND ur.user_id = $1 AND r.code = $2`,
        [userId, roleCode],
      );
    });
  }

  /** Assigns a role (by code) to a user. Roles are cumulable. */
  assignRole(tenantId: string, userId: string, roleCode: string): Promise<void> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const roleRows = await em.query(
        `SELECT id FROM role WHERE code = $1`,
        [roleCode],
      );
      if (roleRows.length === 0) {
        throw new BadRequestException(`Unknown role "${roleCode}"`);
      }
      await em.query(
        `INSERT INTO user_role (tenant_id, user_id, role_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
        [tenantId, userId, roleRows[0].id],
      );
    });
  }

  /**
   * Toutes les permissions de l'utilisateur, tous rôles cumulés (dédoublonnées).
   *
   * Sert au miroir `/me/capabilities` : sans elle, l'écran ne connaît que les jetons et propose
   * des boutons d'écriture à un rôle en lecture, qui se heurte alors à un 403. La garde serveur
   * reste seule juge — ceci ne fait qu'éviter d'offrir une action vouée à l'échec.
   */
  listPermissionsForUser(
    tenantId: string,
    userId: string | undefined,
  ): Promise<string[]> {
    if (!userId) {
      return Promise.resolve([]);
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT DISTINCT p.key
           FROM user_role ur
           JOIN role_permission rp ON rp.role_id = ur.role_id
           JOIN permission p ON p.id = rp.permission_id
          WHERE ur.user_id = $1
          ORDER BY p.key`,
        [userId],
      );
      return rows.map((r: { key: string }) => r.key);
    });
  }

  /** True if the user holds any role granting the given permission key. */
  hasPermission(
    tenantId: string,
    userId: string | undefined,
    permissionKey: string,
  ): Promise<boolean> {
    if (!userId) {
      return Promise.resolve(false);
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT 1
           FROM user_role ur
           JOIN role_permission rp ON rp.role_id = ur.role_id
           JOIN permission p ON p.id = rp.permission_id
          WHERE ur.user_id = $1 AND p.key = $2
          LIMIT 1`,
        [userId, permissionKey],
      );
      return rows.length > 0;
    });
  }
}
