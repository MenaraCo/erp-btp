import { Module } from '@nestjs/common';
import { TenantContext } from './tenant-context';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantTransactionService } from './tenant-transaction';
import { TenantMiddleware } from './tenant.middleware';

/**
 * Multi-tenancy core: request context, tenant resolution (sub-domain + header), the
 * middleware that establishes the context, and the tenant-scoped transaction helper.
 * Relies on the global DataSource provided by TypeOrmModule.forRoot in AppModule.
 */
@Module({
  providers: [
    TenantContext,
    TenantResolverService,
    TenantTransactionService,
    TenantMiddleware,
  ],
  exports: [
    TenantContext,
    TenantResolverService,
    TenantTransactionService,
    TenantMiddleware,
  ],
})
export class TenancyModule {}
