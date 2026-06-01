import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantStore {
  tenantId: string;
}

/**
 * Request-scoped tenant identity, propagated across async boundaries via AsyncLocalStorage.
 * The middleware establishes it; services read it (directly or via TenantTransactionService).
 */
@Injectable()
export class TenantContext {
  private readonly als = new AsyncLocalStorage<TenantStore>();

  run<T>(tenantId: string, callback: () => T): T {
    return this.als.run({ tenantId }, callback);
  }

  getTenantId(): string | undefined {
    return this.als.getStore()?.tenantId;
  }

  requireTenantId(): string {
    const tenantId = this.getTenantId();
    if (!tenantId) {
      throw new Error('No tenant in the current execution context');
    }
    return tenantId;
  }
}
