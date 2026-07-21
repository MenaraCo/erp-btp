import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runInTenant } from '../tenancy/tenant-transaction';
import { CatalogService } from '../catalog/catalog.service';

/**
 * Source of truth for "can this user use this capability". Combines:
 *  - the catalogue (capability -> modules that unlock it),
 *  - the tenant's active modules (tenant_module),
 *  - the user's seats (seat_assignment).
 * All tenant tables are read/written inside runInTenant so RLS scopes them to the tenant.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly catalog: CatalogService,
  ) {}

  /** Module codes currently active for the tenant. */
  getActiveModuleCodes(tenantId: string): Promise<string[]> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT module_code FROM tenant_module WHERE active = true`,
      );
      return rows.map((r: { module_code: string }) => r.module_code);
    });
  }

  /** True if the user holds a seat for any of the given module codes. */
  hasSeatForModules(
    tenantId: string,
    userId: string | undefined,
    moduleCodes: string[],
  ): Promise<boolean> {
    if (!userId || moduleCodes.length === 0) {
      return Promise.resolve(false);
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT 1 FROM seat_assignment WHERE user_id = $1 AND module_code = ANY($2) LIMIT 1`,
        [userId, moduleCodes],
      );
      return rows.length > 0;
    });
  }

  /**
   * Enforces a capability for the current tenant + user.
   * Throws ForbiddenException when the module is not active or the user has no seat.
   */
  async assertCapability(
    tenantId: string,
    userId: string | undefined,
    capability: string,
  ): Promise<void> {
    const providerModules =
      await this.catalog.getModuleCodesForCapability(capability);
    if (providerModules.length === 0) {
      throw new ForbiddenException(`Unknown capability "${capability}"`);
    }
    const activeModules = await this.getActiveModuleCodes(tenantId);
    const activeProviders = providerModules.filter((code) =>
      activeModules.includes(code),
    );
    if (activeProviders.length === 0) {
      throw new ForbiddenException(
        `Capability "${capability}" is not active for this tenant`,
      );
    }
    const hasSeat = await this.hasSeatForModules(
      tenantId,
      userId,
      activeProviders,
    );
    if (!hasSeat) {
      throw new ForbiddenException(
        `No seat (jeton) assigned for capability "${capability}"`,
      );
    }
  }

  /** Users of the tenant (for the seat-assignment console). */
  listUsers(
    tenantId: string,
  ): Promise<Array<{ id: string; email: string; fullName: string | null }>> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT id, email, full_name FROM user_account
          WHERE status = 'active' AND deleted_at IS NULL
          ORDER BY full_name NULLS LAST, email`,
      );
      return rows.map(
        (r: { id: string; email: string; full_name: string | null }) => ({
          id: r.id,
          email: r.email,
          fullName: r.full_name,
        }),
      );
    });
  }

  /** All seat (jeton) assignments for the tenant, with the user identity, optionally by module. */
  listSeatAssignments(
    tenantId: string,
    moduleCode?: string,
  ): Promise<
    Array<{
      id: string;
      moduleCode: string;
      userId: string;
      email: string;
      fullName: string | null;
      assignedAt: Date;
    }>
  > {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT sa.id, sa.module_code, sa.user_id, sa.assigned_at,
                u.email, u.full_name
           FROM seat_assignment sa
           JOIN user_account u ON u.id = sa.user_id
          WHERE ($1::varchar IS NULL OR sa.module_code = $1)
          ORDER BY sa.module_code, u.full_name NULLS LAST, u.email`,
        [moduleCode ?? null],
      );
      return rows.map(
        (r: {
          id: string;
          module_code: string;
          user_id: string;
          assigned_at: Date;
          email: string;
          full_name: string | null;
        }) => ({
          id: r.id,
          moduleCode: r.module_code,
          userId: r.user_id,
          email: r.email,
          fullName: r.full_name,
          assignedAt: r.assigned_at,
        }),
      );
    });
  }

  /** Removes a seat assignment (frees a jeton). No-op if it does not exist. */
  unassignSeat(tenantId: string, assignmentId: string): Promise<void> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await em.query(`DELETE FROM seat_assignment WHERE id = $1`, [assignmentId]);
    });
  }

  /**
   * Assigns a module seat (jeton) to a user, enforcing assigned <= purchased.
   * Locks the tenant_module row to serialise concurrent assignments.
   */
  assignSeat(
    tenantId: string,
    moduleCode: string,
    userId: string,
    assignedBy?: string,
  ): Promise<void> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const tm = await em.query(
        `SELECT seats_purchased FROM tenant_module WHERE module_code = $1 FOR UPDATE`,
        [moduleCode],
      );
      if (tm.length === 0) {
        throw new BadRequestException(
          `Module "${moduleCode}" is not active for this tenant`,
        );
      }
      const purchased = Number(tm[0].seats_purchased);
      const used = await em.query(
        `SELECT count(*)::int AS n FROM seat_assignment WHERE module_code = $1`,
        [moduleCode],
      );
      if (Number(used[0].n) >= purchased) {
        throw new ConflictException(
          `No seats left for module "${moduleCode}" (purchased ${purchased})`,
        );
      }
      await em.query(
        `INSERT INTO seat_assignment (tenant_id, module_code, user_id, assigned_by)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, moduleCode, userId, assignedBy ?? null],
      );
    });
  }
}
