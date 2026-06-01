import { SetMetadata } from '@nestjs/common';

export const REQUIRES_CAPABILITY = 'requiresCapability';

/**
 * Marks an endpoint/handler as requiring a capability. The CapabilityGuard then enforces,
 * for the current tenant + user: (a) a module unlocking this capability is active, and
 * (b) the user holds a seat (jeton) for it. Always pass a capability key (e.g. 'estimating.bid'),
 * never a module or pack name (cahier des charges §3.1).
 */
export const RequiresCapability = (capability: string) =>
  SetMetadata(REQUIRES_CAPABILITY, capability);
