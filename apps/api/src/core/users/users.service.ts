import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runInTenant } from '../tenancy/tenant-transaction';
import { AuthService } from '../auth/auth.service';
import { RbacService } from '../rbac/rbac.service';
import { splitName } from '../auth/person-name.util';

export interface CreateUserInput {
  email: string;
  /** Fonction dans l'entreprise, facultative. */
  jobTitle?: string | null;
  /** Prénom et nom saisis séparément. `fullName` reste accepté (rétro-compat) et recomposé. */
  firstName?: string;
  lastName?: string;
  fullName?: string;
  password: string;
  /** Optional initial role granted at creation. */
  roleCode?: string | null;
}

export interface UserWithRoles {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  /** Fonction dans l'entreprise (gérant, conducteur de travaux…). */
  jobTitle: string | null;
  roles: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Tenant user administration (cahier des charges §3.2) : le référent d'une société crée les
 * comptes de ses collaborateurs et leur attribue des rôles. L'accès aux modules reste régi par
 * les jetons (console d'abonnement), orthogonal aux rôles gérés ici.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auth: AuthService,
    private readonly rbac: RbacService,
  ) {}

  /** Active tenant users, each with their role codes. */
  listUsersWithRoles(tenantId: string): Promise<UserWithRoles[]> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT u.id, u.email, u.full_name, u.first_name, u.last_name, u.job_title,
                COALESCE(ARRAY_AGG(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
           FROM user_account u
           LEFT JOIN user_role ur ON ur.user_id = u.id
           LEFT JOIN role r ON r.id = ur.role_id
          WHERE u.status = 'active' AND u.deleted_at IS NULL
          GROUP BY u.id, u.email, u.full_name, u.first_name, u.last_name, u.job_title
          ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.full_name NULLS LAST, u.email`,
      );
      return rows.map(
        (r: {
          id: string;
          email: string;
          full_name: string | null;
          first_name: string | null;
          last_name: string | null;
          job_title: string | null;
          roles: string[];
        }) => ({
          id: r.id,
          email: r.email,
          firstName: r.first_name,
          lastName: r.last_name,
          fullName: r.full_name,
          jobTitle: r.job_title,
          roles: r.roles ?? [],
        }),
      );
    });
  }

  /**
   * Liste légère des utilisateurs actifs pour les sélecteurs (responsable, conducteur…) :
   * juste un identifiant et un libellé affichable. Accessible plus largement que la console
   * d'administration — n'importe quel deviseur doit pouvoir désigner un responsable.
   */
  listPickable(tenantId: string): Promise<{ id: string; label: string }[]> {
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT id, full_name, email FROM user_account
          WHERE status = 'active' AND deleted_at IS NULL
          ORDER BY full_name NULLS LAST, email`,
      );
      return rows.map((r: { id: string; full_name: string | null; email: string }) => ({
        id: r.id,
        label: r.full_name || r.email,
      }));
    });
  }

  /** Creates a colleague account within the tenant and optionally grants an initial role. */
  async createUser(tenantId: string, input: CreateUserInput): Promise<UserWithRoles> {
    const email = (input.email ?? '').trim().toLowerCase();
    const { firstName, lastName, fullName } = splitName(input);
    const password = input.password ?? '';
    if (!EMAIL_RE.test(email)) throw new BadRequestException('A valid email is required');
    if (!fullName) throw new BadRequestException('Le prénom et le nom sont requis.');
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const userId = await runInTenant(this.dataSource, tenantId, async (em) => {
      const existing = await em.query(
        `SELECT 1 FROM user_account WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
        [email],
      );
      if (existing.length > 0) {
        throw new ConflictException('Un utilisateur avec cet e-mail existe déjà.');
      }
      const rows = await em.query(
        `INSERT INTO user_account (tenant_id, email, full_name, first_name, last_name, job_title)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, email, fullName, firstName, lastName, (input.jobTitle ?? '').trim() || null],
      );
      return rows[0].id as string;
    });

    await this.auth.setPassword(tenantId, userId, password);
    if (input.roleCode) {
      await this.rbac.assignRole(tenantId, userId, input.roleCode);
    }

    return {
      id: userId,
      email,
      firstName,
      lastName,
      fullName,
      jobTitle: (input.jobTitle ?? '').trim() || null,
      roles: input.roleCode ? [input.roleCode] : [],
    };
  }
}
