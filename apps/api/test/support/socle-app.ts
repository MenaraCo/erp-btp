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
import { applyGlobalPipes } from '../../src/core/common/global-pipes';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { TenantMiddleware } from '../../src/core/tenancy/tenant.middleware';
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { EntitlementsModule } from '../../src/core/entitlements/entitlements.module';
import { EntitlementsService } from '../../src/core/entitlements/entitlements.service';
import { ActivityModule } from '../../src/core/activity/activity.module';
import { RbacModule } from '../../src/core/rbac/rbac.module';
import { RbacService } from '../../src/core/rbac/rbac.service';
import { SubscriptionsModule } from '../../src/core/subscriptions/subscriptions.module';
import { DirectoryModule } from '../../src/modules/directory/directory.module';
import { EstimatingModule } from '../../src/modules/estimating/estimating.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { ComplianceModule } from '../../src/modules/compliance/compliance.module';
import { SiteTrackingModule } from '../../src/modules/site-tracking/site-tracking.module';
import { AnalyticalModule } from '../../src/modules/analytical/analytical.module';
import { FinancialManagementModule } from '../../src/modules/financial-management/financial-management.module';
import { ParamsModule } from '../../src/modules/params/params.module';
import { SearchModule } from '../../src/core/common/search/search.module';
import { createTenant } from './datasource';
import { createUser, activateModule } from './entitlements.helpers';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
    TenancyModule,
    CatalogModule,
    EntitlementsModule,
    ActivityModule,
    RbacModule,
    SubscriptionsModule,
    DirectoryModule,
    EstimatingModule,
    InvoicingModule,
    ComplianceModule,
    SiteTrackingModule,
    AnalyticalModule,
    FinancialManagementModule,
    ParamsModule,
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
  // Même validation qu'en production : une règle vérifiée nulle part n'est pas une règle.
  applyGlobalPipes(app);
  await app.init();
  // Un serveur qui ÉCOUTE, une bonne fois. Sans cela, supertest ouvre puis referme un port
  // éphémère à chaque requête : sur 120 suites, des milliers de ports en TIME_WAIT, et une
  // requête finit par atterrir ailleurs — d'où des 404 sur des routes qui existent, et des
  // « socket hang up » qui n'ont rien à voir avec le code testé.
  await app.listen(0);
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
  moduleCode: string | string[] = 'core',
): Promise<{ tenantId: string; userId: string }> {
  const tenant = await createTenant(ds, name);
  const userId = await createUser(ds, tenant.id, `u@${tenant.slug}.test`);
  const modules = Array.isArray(moduleCode) ? moduleCode : [moduleCode];
  for (const code of modules) {
    await activateModule(ds, tenant.id, code, 5);
    await app.get(EntitlementsService).assignSeat(tenant.id, code, userId);
  }
  await app.get(RbacService).provisionSystemRoles(tenant.id);
  await app.get(RbacService).assignRole(tenant.id, userId, roleCode);
  return { tenantId: tenant.id, userId };
}
