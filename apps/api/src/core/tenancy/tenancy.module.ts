import { Module } from '@nestjs/common';
import { TenantContext } from './tenant-context';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantTransactionService } from './tenant-transaction';
import { TenantMiddleware } from './tenant.middleware';
import { AuthTokenModule } from '../auth/auth-token.module';

/**
 * Multi-tenancy core: request context, tenant resolution (sub-domain + header + Bearer token),
 * the middleware that establishes the context, and the tenant-scoped transaction helper.
 * Relies on the global DataSource provided by TypeOrmModule.forRoot in AppModule.
 */
@Module({
  imports: [AuthTokenModule],
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
    // Re-exported so modules applying TenantMiddleware can resolve its AuthTokenService dep.
    AuthTokenModule,
  ],
})
export class TenancyModule {}
