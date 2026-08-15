import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { RequiresPermission } from '../rbac/requires-permission.decorator';
import { TenantContext } from '../tenancy/tenant-context';
import { EntitlementsService } from './entitlements.service';

interface AssignInput {
  moduleCode?: string;
  userId?: string;
}

/**
 * Seat (jeton) assignment console for the tenant admin (cahier §3.7 A): which user has access
 * to which module. Enforces assigned <= purchased in the service. Gated by RBAC
 * (entitlements.seat.assign) — assigning a jeton is an admin action, not a licensed capability.
 */
@Controller()
export class SeatController {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly context: TenantContext,
  ) {}

  /** Tenant users, to pick who receives a jeton. */
  @Get('users')
  @RequiresPermission('entitlements.seat.assign')
  users() {
    return this.entitlements.listUsers(this.context.requireTenantId());
  }

  /**
   * État du pool de jetons : acheté / posé / restant. L'écran d'abonnement s'en sert pour montrer
   * ce qu'il reste AVANT que l'utilisateur ne tente une affectation qui échouerait.
   */
  @Get('seats/pool')
  @RequiresPermission('entitlements.seat.assign')
  pool() {
    return this.entitlements.getSeatPool(this.context.requireTenantId());
  }

  /** Current jeton assignments, optionally filtered by module. */
  @Get('seats')
  @RequiresPermission('entitlements.seat.assign')
  seats(@Query('module') moduleCode?: string) {
    return this.entitlements.listSeatAssignments(
      this.context.requireTenantId(),
      moduleCode,
    );
  }

  /** Assigns a jeton of a module to a user. */
  @Post('seats')
  @RequiresPermission('entitlements.seat.assign')
  async assign(@Body() body: AssignInput) {
    if (!body?.moduleCode || !body?.userId) {
      throw new BadRequestException('moduleCode and userId are required');
    }
    const tenantId = this.context.requireTenantId();
    await this.entitlements.assignSeat(
      tenantId,
      body.moduleCode,
      body.userId,
      this.context.getUserId(),
    );
    return this.entitlements.listSeatAssignments(tenantId);
  }

  /** Frees a jeton. */
  @Delete('seats/:id')
  @RequiresPermission('entitlements.seat.assign')
  async unassign(@Param('id') id: string) {
    const tenantId = this.context.requireTenantId();
    await this.entitlements.unassignSeat(tenantId, id);
    return this.entitlements.listSeatAssignments(tenantId);
  }
}
