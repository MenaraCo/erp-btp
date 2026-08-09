import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { RequiresPermission } from '../rbac/requires-permission.decorator';
import { TenantContext } from '../tenancy/tenant-context';
import { RbacService } from '../rbac/rbac.service';
import { CreateUserInput, UsersService } from './users.service';

/**
 * Console d'administration des utilisateurs et rôles d'une société (cahier §3.2). Gardée par la
 * permission RBAC `rbac.user_role.assign` — seul un référent habilité gère les comptes et rôles.
 * L'accès aux modules (jetons) se gère à part, dans la console d'abonnement (§3.7 A).
 */
@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly rbac: RbacService,
    private readonly context: TenantContext,
  ) {}

  /** Tenant users with their roles. */
  @Get('admin/users')
  @RequiresPermission('rbac.user_role.assign')
  list() {
    return this.users.listUsersWithRoles(this.context.requireTenantId());
  }

  /** Liste légère (id + libellé) pour les sélecteurs — responsable, conducteur de travaux… */
  @Get('users/pickable')
  @RequiresPermission('estimating.devis.read')
  pickable() {
    return this.users.listPickable(this.context.requireTenantId());
  }

  /** Creates a colleague account (+ optional initial role). */
  @Post('admin/users')
  @RequiresPermission('rbac.user_role.assign')
  create(@Body() body: CreateUserInput) {
    if (!body?.email || !body?.password || !body?.fullName) {
      throw new BadRequestException('email, fullName and password are required');
    }
    return this.users.createUser(this.context.requireTenantId(), body);
  }

  /** Catalogue of tenant roles with their permissions. */
  @Get('roles')
  @RequiresPermission('rbac.user_role.assign')
  roles() {
    return this.rbac.listRoles(this.context.requireTenantId());
  }

  /** Role codes held by a user. */
  @Get('admin/users/:userId/roles')
  @RequiresPermission('rbac.user_role.assign')
  userRoles(@Param('userId') userId: string) {
    return this.rbac.listUserRoles(this.context.requireTenantId(), userId);
  }

  /** Grants a role to a user; returns the updated role list. */
  @Post('admin/users/:userId/roles')
  @RequiresPermission('rbac.user_role.assign')
  async assign(@Param('userId') userId: string, @Body() body: { roleCode?: string }) {
    if (!body?.roleCode) {
      throw new BadRequestException('roleCode is required');
    }
    const tenantId = this.context.requireTenantId();
    await this.rbac.assignRole(tenantId, userId, body.roleCode);
    return this.rbac.listUserRoles(tenantId, userId);
  }

  /** Revokes a role from a user; returns the updated role list. */
  @Delete('admin/users/:userId/roles/:roleCode')
  @RequiresPermission('rbac.user_role.assign')
  async revoke(@Param('userId') userId: string, @Param('roleCode') roleCode: string) {
    const tenantId = this.context.requireTenantId();
    await this.rbac.revokeRole(tenantId, userId, roleCode);
    return this.rbac.listUserRoles(tenantId, userId);
  }
}
