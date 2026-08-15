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

/** État du pool de jetons d'une société : ce qui est acheté, posé, et ce qu'il reste. */
export interface SeatPool {
  /** Jetons du palier = sièges achetés × jetons par siège. */
  total: number;
  /** Jetons ouverts par siège : réglé par l'éditeur, à défaut le nombre de modules du palier. */
  tokensPerSeat: number;
  /** Jetons déjà posés sur les modules du palier, tous modules confondus. */
  used: number;
  remaining: number;
  /** Modules couverts par le palier — ceux qui puisent dans le pool. */
  packModules: string[];
}

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

  /**
   * Capacités RÉELLEMENT ouvertes à l'utilisateur courant : module actif chez le tenant ET jeton
   * affecté. C'est ce que le frontend lit pour n'afficher que les entrées de menu utilisables —
   * l'écran ne décide rien, il se contente de refléter la même règle que la garde côté serveur.
   */
  async listCapabilitiesForUser(
    tenantId: string,
    userId: string | undefined,
  ): Promise<string[]> {
    const active = await this.getActiveModuleCodes(tenantId);
    if (active.length === 0 || !userId) {
      return [];
    }
    const seated = await runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT module_code FROM seat_assignment WHERE user_id = $1 AND module_code = ANY($2)`,
        [userId, active],
      );
      return rows.map((r: { module_code: string }) => r.module_code);
    });
    const keys = await this.catalog.getCapabilityKeysForModuleCodes(seated);
    return [...keys].sort();
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
  /**
   * Lecture du pool de jetons dans une transaction déjà ouverte.
   *
   * Le palier vend des SIÈGES, et chaque siège ouvre autant de jetons que le palier compte de
   * modules : « Pro » (Socle + Études de prix + Facturation) vaut 3 jetons par siège. Ces jetons
   * sont ensuite librement répartis — un jeton posé sur un module en retire un au total commun,
   * quel que soit le module.
   *
   * `lock` verrouille la souscription le temps d'une affectation : sans cela, deux affectations
   * simultanées liraient le même « il en reste 1 » et dépasseraient le quota payé.
   */
  private async readPool(
    em: { query: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>> },
    lock = false,
  ): Promise<SeatPool> {
    const sub = (
      await em.query(
        `SELECT pack_code, pack_seats FROM subscription${lock ? ' FOR UPDATE' : ''}`,
      )
    )[0] as { pack_code: string | null; pack_seats: number | null } | undefined;

    if (!sub?.pack_code) {
      return { total: 0, tokensPerSeat: 0, used: 0, remaining: 0, packModules: [] };
    }
    const rows = await em.query(
      `SELECT m.code, p.seat_tokens FROM pack p
         JOIN pack_module pm ON pm.pack_id = p.id
         JOIN module m ON m.id = pm.module_id
        WHERE p.code = $1`,
      [sub.pack_code],
    );
    const packModules = rows.map((r) => r.code as string);
    const seats = Number(sub.pack_seats ?? 0);
    // L'éditeur peut fixer les jetons par siège ; sans réglage, un siège ouvre un jeton par
    // module du palier — la valeur qui préserve exactement la valeur vendue.
    const configured = rows[0]?.seat_tokens as number | null | undefined;
    const tokensPerSeat =
      configured === null || configured === undefined ? packModules.length : Number(configured);
    const total = seats * tokensPerSeat;

    const used = packModules.length
      ? Number(
          (
            (await em.query(
              `SELECT count(*)::int AS n FROM seat_assignment WHERE module_code = ANY($1)`,
              [packModules],
            )) as Array<{ n: number }>
          )[0].n,
        )
      : 0;

    return { total, tokensPerSeat, used, remaining: Math.max(0, total - used), packModules };
  }

  /** État du pool de jetons de la société — ce que l'écran d'abonnement affiche. */
  getSeatPool(tenantId: string): Promise<SeatPool> {
    return runInTenant(this.dataSource, tenantId, (em) => this.readPool(em));
  }

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

      // Les modules du palier puisent dans le POOL COMMUN de la société ; les options, achetées
      // séparément au siège, gardent leur propre compteur.
      const pool = await this.readPool(em, true);
      if (pool.packModules.includes(moduleCode)) {
        if (pool.remaining <= 0) {
          throw new ConflictException(
            `Plus de jeton disponible : ${pool.used}/${pool.total} déjà affectés. `
            + `Retirez un jeton à un utilisateur, ou augmentez le nombre de jetons de votre formule.`,
          );
        }
      } else {
        const purchased = Number(tm[0].seats_purchased);
        const used = await em.query(
          `SELECT count(*)::int AS n FROM seat_assignment WHERE module_code = $1`,
          [moduleCode],
        );
        if (Number(used[0].n) >= purchased) {
          throw new ConflictException(
            `Plus de jeton disponible pour l’option « ${moduleCode} » (${purchased} acheté(s)).`,
          );
        }
      }
      await em.query(
        `INSERT INTO seat_assignment (tenant_id, module_code, user_id, assigned_by)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, moduleCode, userId, assignedBy ?? null],
      );
    });
  }
}
