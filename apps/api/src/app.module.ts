import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadAppConfig } from './config/env.config';
import { buildTypeOrmOptions } from './database/typeorm.config';
import { TenancyModule } from './core/tenancy/tenancy.module';
import { TenantMiddleware } from './core/tenancy/tenant.middleware';
import { CatalogModule } from './core/catalog/catalog.module';
import { EntitlementsModule } from './core/entitlements/entitlements.module';
import { SubscriptionsModule } from './core/subscriptions/subscriptions.module';
import { PromoModule } from './core/promo/promo.module';
import { PricingModule } from './core/pricing/pricing.module';
import { PaymentsModule } from './core/payments/payments.module';
import { CompanyLookupModule } from './core/company-lookup/company-lookup.module';
import { EditorModule } from './core/editor/editor.module';
import { ActivityModule } from './core/activity/activity.module';
import { NumberingModule } from './core/numbering/numbering.module';
import { RbacModule } from './core/rbac/rbac.module';
import { AuthModule } from './core/auth/auth.module';
import { UsersModule } from './core/users/users.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { EstimatingModule } from './modules/estimating/estimating.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { SiteTrackingModule } from './modules/site-tracking/site-tracking.module';
import { AnalyticalModule } from './modules/analytical/analytical.module';
import { FinancialManagementModule } from './modules/financial-management/financial-management.module';
import { ParamsModule } from './modules/params/params.module';
import { SearchModule } from './core/common/search/search.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadAppConfig],
    }),
    TypeOrmModule.forRootAsync({ useFactory: () => buildTypeOrmOptions() }),
    TenancyModule,
    CatalogModule,
    EntitlementsModule,
    SubscriptionsModule,
    PromoModule,
    PricingModule,
    PaymentsModule,
    CompanyLookupModule,
    EditorModule,
    ActivityModule,
    NumberingModule,
    RbacModule,
    AuthModule,
    UsersModule,
    DirectoryModule,
    EstimatingModule,
    InvoicingModule,
    ComplianceModule,
    SiteTrackingModule,
    AnalyticalModule,
    FinancialManagementModule,
    ParamsModule,
    SearchModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Every route requires a tenant, except the public health check and public sign-up
    // (register creates the tenant, so it cannot be tenant-scoped — cahier §3.3).
    // Le webhook de paiement en est également exclu : le prestataire n'a ni compte ni société
    // chez nous, c'est le CONTENU SIGNÉ de l'événement qui désigne le tenant concerné.
    consumer
      .apply(TenantMiddleware)
      .exclude(
        'health',
        'auth/register',
        'auth/companies',
        'webhooks/paiement',
        'public/catalog/modules',
        'public/catalog/packs',
        'public/catalog/pricing',
        'public/company-search',
      )
      .forRoutes('*');
  }
}
