import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { TenantMiddleware } from '../../src/core/tenancy/tenant.middleware';
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { EntitlementsModule } from '../../src/core/entitlements/entitlements.module';
import { EntitlementsService } from '../../src/core/entitlements/entitlements.service';
import { RbacModule } from '../../src/core/rbac/rbac.module';
import { RbacService } from '../../src/core/rbac/rbac.service';
import { DirectoryModule } from '../../src/modules/directory/directory.module';
import { EstimatingModule } from '../../src/modules/estimating/estimating.module';
import { SearchModule } from '../../src/core/common/search/search.module';
import { createTenant } from './datasource';
import { createUser, activateModule } from './entitlements.helpers';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
    TenancyModule,
    CatalogModule,
    EntitlementsModule,
    RbacModule,
    DirectoryModule,
    EstimatingModule,
    SearchModule,
  ],
})
export class SocleTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

export async function buildSocleApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [SocleTestModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

/**
 * Creates a tenant + user fully entitled to the given module (active + seat) with the given
 * role. Defaults to the `core` module (directory capability). Returns ids for use as
 * X-Tenant-Id / X-User-Id headers.
 */
export async function entitleUser(
  app: INestApplication,
  ds: DataSource,
  name: string,
  roleCode = 'admin',
  moduleCode = 'core',
): Promise<{ tenantId: string; userId: string }> {
  const tenant = await createTenant(ds, name);
  const userId = await createUser(ds, tenant.id, `u@${tenant.slug}.test`);
  await activateModule(ds, tenant.id, moduleCode, 5);
  await app.get(EntitlementsService).assignSeat(tenant.id, moduleCode, userId);
  await app.get(RbacService).provisionSystemRoles(tenant.id);
  await app.get(RbacService).assignRole(tenant.id, userId, roleCode);
  return { tenantId: tenant.id, userId };
}
