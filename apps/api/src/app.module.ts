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
import { RbacModule } from './core/rbac/rbac.module';
import { AuthModule } from './core/auth/auth.module';
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
    RbacModule,
    AuthModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Every route requires a tenant, except the public health check.
    consumer.apply(TenantMiddleware).exclude('health').forRoutes('*');
  }
}
