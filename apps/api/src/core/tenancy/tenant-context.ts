import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  tenantId: string;
  /** Current user, when known. Set by the middleware; full auth lands in phase 0.7. */
  userId?: string;
  /** Current user's email, from the access token — used by the editor back-office guard. */
  email?: string;
}

/**
 * Request-scoped tenant + user identity, propagated across async boundaries via
 * AsyncLocalStorage. The middleware establishes it; services and guards read it.
 */
@Injectable()
export class TenantContext {
  private readonly als = new AsyncLocalStorage<TenantStore>();

  run<T>(store: TenantStore, callback: () => T): T {
    return this.als.run(store, callback);
  }

  getTenantId(): string | undefined {
    return this.als.getStore()?.tenantId;
  }

  getUserId(): string | undefined {
    return this.als.getStore()?.userId;
  }

  getEmail(): string | undefined {
    return this.als.getStore()?.email;
  }

  requireTenantId(): string {
    const tenantId = this.getTenantId();
    if (!tenantId) {
      throw new Error('No tenant in the current execution context');
    }
    return tenantId;
  }
}
