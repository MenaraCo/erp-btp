import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadAppConfig } from './config/env.config';
import { buildTypeOrmOptions } from './database/typeorm.config';
import { TenancyModule } from './core/tenancy/tenancy.module';
import { TenantMiddleware } from './core/tenancy/tenant.middleware';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadAppConfig],
    }),
    TypeOrmModule.forRootAsync({ useFactory: () => buildTypeOrmOptions() }),
    TenancyModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Every route requires a tenant, except the public health check.
    consumer.apply(TenantMiddleware).exclude('health').forRoutes('*');
  }
}
