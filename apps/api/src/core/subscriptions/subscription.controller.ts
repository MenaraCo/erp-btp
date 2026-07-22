import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { RequiresPermission } from '../rbac/requires-permission.decorator';
import { TenantContext } from '../tenancy/tenant-context';
import { SubscriptionService } from './subscription.service';
import { PackSubscriptionService } from './pack-subscription.service';

interface DirectInput {
  modules?: Array<{ moduleCode: string; seats: number }>;
}

interface ModuleInput {
  moduleCode?: string;
  seats?: number;
}

interface CancelInput {
  cancel?: boolean;
}
interface PackInput {
  packCode?: string;
  seats?: number;
}
interface AddonInput {
  moduleCode?: string;
  seats?: number;
}

/**
 * Subscription management — two independent entry doors (cahier §3.3):
 * POST /subscription/trial (Porte 1, trialing) and POST /subscription/direct (Porte 2, active).
 * Core admin action, gated by RBAC only (not a licensed module capability).
 */
@Controller('subscription')
export class SubscriptionController {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly packSubscriptions: PackSubscriptionService,
    private readonly context: TenantContext,
  ) {}

  @Get()
  @RequiresPermission('subscription.manage')
  get() {
    return this.subscriptions.getSubscription(this.context.requireTenantId());
  }

  @Post('trial')
  @RequiresPermission('subscription.manage')
  async startTrial() {
    const tenantId = this.context.requireTenantId();
    await this.subscriptions.startTrial(tenantId);
    return this.subscriptions.getSubscription(tenantId);
  }

  @Post('direct')
  @RequiresPermission('subscription.manage')
  async subscribeDirect(@Body() body: DirectInput) {
    if (!Array.isArray(body?.modules) || body.modules.length === 0) {
      throw new BadRequestException('modules[] is required');
    }
    const tenantId = this.context.requireTenantId();
    await this.subscriptions.subscribeDirect(tenantId, body.modules);
    return this.subscriptions.getSubscription(tenantId);
  }

  /** Subscribed modules with seats purchased vs. assigned (jetons) — feeds the console. */
  @Get('modules')
  @RequiresPermission('subscription.manage')
  modules() {
    return this.subscriptions.getSubscribedModules(this.context.requireTenantId());
  }

  /** Add or adjust a paid module (immediate effect, §3.4). */
  @Post('module')
  @RequiresPermission('subscription.manage')
  async subscribeModule(@Body() body: ModuleInput) {
    if (!body?.moduleCode) {
      throw new BadRequestException('moduleCode is required');
    }
    const seats = Number(body.seats);
    if (!Number.isInteger(seats) || seats < 0) {
      throw new BadRequestException('seats must be a non-negative integer');
    }
    const tenantId = this.context.requireTenantId();
    await this.subscriptions.subscribeModule(tenantId, body.moduleCode, seats);
    return this.subscriptions.getSubscribedModules(tenantId);
  }

  /** Résiliation à la fin de période (§3.4). Body `{ cancel: false }` revokes it. */
  @Post('cancel')
  @RequiresPermission('subscription.manage')
  cancel(@Body() body: CancelInput) {
    const cancel = body?.cancel ?? true;
    return this.subscriptions.setCancelAtPeriodEnd(
      this.context.requireTenantId(),
      cancel,
    );
  }

  /* ── Offre par paliers ── */

  /** Catalogue des paliers (Essentiel → Pro Max) avec leur contenu et leur prix. */
  @Get('packs')
  @RequiresPermission('subscription.manage')
  packs() {
    return this.packSubscriptions.listPacks();
  }

  /** Palier et options actuellement souscrits. */
  @Get('pack')
  @RequiresPermission('subscription.manage')
  packState() {
    return this.packSubscriptions.getState(this.context.requireTenantId());
  }

  /** Options du catalogue, avec leur éligibilité au palier courant. */
  @Get('addons')
  @RequiresPermission('subscription.manage')
  addons() {
    return this.packSubscriptions.listAddons(this.context.requireTenantId());
  }

  /** Souscrit ou change de palier (les options non couvertes passent en lecture seule). */
  @Post('pack')
  @RequiresPermission('subscription.manage')
  subscribePack(@Body() body: PackInput) {
    if (!body?.packCode) {
      throw new BadRequestException('packCode est requis');
    }
    return this.packSubscriptions.subscribeToPack(
      this.context.requireTenantId(),
      body.packCode,
      Number(body.seats ?? 1),
    );
  }

  /** Ajoute/ajuste une option (jetons > 0) ou la retire (jetons = 0). */
  @Post('addon')
  @RequiresPermission('subscription.manage')
  setAddon(@Body() body: AddonInput) {
    if (!body?.moduleCode) {
      throw new BadRequestException('moduleCode est requis');
    }
    return this.packSubscriptions.setAddon(
      this.context.requireTenantId(),
      body.moduleCode,
      Number(body.seats ?? 0),
    );
  }
}
