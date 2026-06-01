import {
  Controller,
  Post,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { TenantMiddleware } from '../../src/core/tenancy/tenant.middleware';
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { EntitlementsModule } from '../../src/core/entitlements/entitlements.module';
import { EntitlementsService } from '../../src/core/entitlements/entitlements.service';
import { RequiresCapability } from '../../src/core/entitlements/requires-capability.decorator';
import { RbacModule } from '../../src/core/rbac/rbac.module';
import { RbacService } from '../../src/core/rbac/rbac.service';
import { RequiresPermission } from '../../src/core/rbac/requires-permission.decorator';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser, activateModule } from '../support/entitlements.helpers';

@Controller('devis')
class DevisController {
  // Requires BOTH a capability (commercial) AND a permission (organisational).
  @Post()
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  create() {
    return { created: true };
  }
}

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
    TenancyModule,
    CatalogModule,
    EntitlementsModule,
    RbacModule,
  ],
  controllers: [DevisController],
})
class DevisModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

describe('RBAC × capacité — deux axes orthogonaux', () => {
  let app: INestApplication;
  let ds: DataSource;
  let entitlements: EntitlementsService;
  let rbac: RbacService;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({
      imports: [DevisModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    entitlements = app.get(EntitlementsService);
    rbac = app.get(RbacService);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  function create(tenantId: string, userId: string) {
    return request(app.getHttpServer())
      .post('/devis')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', tenantId)
      .set('X-User-Id', userId);
  }

  async function setupUser(name: string, roleCode: string) {
    const tenant = await createTenant(ds, name);
    const userId = await createUser(ds, tenant.id, `u@${name}.test`);
    await activateModule(ds, tenant.id, 'estimating', 3);
    await entitlements.assignSeat(tenant.id, 'estimating', userId);
    await rbac.provisionSystemRoles(tenant.id);
    await rbac.assignRole(tenant.id, userId, roleCode);
    return { tenantId: tenant.id, userId };
  }

  it('refuse (403) quand la capacité + le jeton sont OK mais la permission manque', async () => {
    // viewer has estimating.devis.read but NOT estimating.devis.write
    const { tenantId, userId } = await setupUser('OrthoViewer', 'viewer');
    await create(tenantId, userId).expect(403);
  });

  it('autorise quand la capacité + le jeton ET la permission sont réunis', async () => {
    // estimator has estimating.devis.write
    const { tenantId, userId } = await setupUser('OrthoEstimator', 'estimator');
    const res = await create(tenantId, userId).expect(201);
    expect(res.body.created).toBe(true);
  });
});
