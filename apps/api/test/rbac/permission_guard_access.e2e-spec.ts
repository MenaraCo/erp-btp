import {
  Controller,
  Get,
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
import { RbacModule } from '../../src/core/rbac/rbac.module';
import { RbacService } from '../../src/core/rbac/rbac.service';
import { RequiresPermission } from '../../src/core/rbac/requires-permission.decorator';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser } from '../support/entitlements.helpers';

@Controller('admin')
class AdminController {
  @Get('roles')
  @RequiresPermission('rbac.role.manage')
  manageRoles() {
    return { ok: true };
  }
}

@Module({
  imports: [TypeOrmModule.forRoot(buildTypeOrmOptions('app')), TenancyModule, RbacModule],
  controllers: [AdminController],
})
class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

describe('PermissionGuard — accès RBAC (autorisé / refusé)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let rbac: RbacService;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({
      imports: [AdminModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    rbac = app.get(RbacService);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  function call(tenantId: string, userId?: string) {
    const req = request(app.getHttpServer())
      .get('/admin/roles')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', tenantId);
    return userId ? req.set('X-User-Id', userId) : req;
  }

  it('autorise un utilisateur avec le rôle admin', async () => {
    const tenant = await createTenant(ds, 'RbacAdmin');
    const userId = await createUser(ds, tenant.id, 'admin@rbac.test');
    await rbac.provisionSystemRoles(tenant.id);
    await rbac.assignRole(tenant.id, userId, 'admin');

    const res = await call(tenant.id, userId).expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('refuse (403) un utilisateur sans la permission requise', async () => {
    const tenant = await createTenant(ds, 'RbacViewer');
    const userId = await createUser(ds, tenant.id, 'viewer@rbac.test');
    await rbac.provisionSystemRoles(tenant.id);
    await rbac.assignRole(tenant.id, userId, 'viewer'); // viewer lacks rbac.role.manage

    await call(tenant.id, userId).expect(403);
  });

  it('refuse (403) un utilisateur sans aucun rôle', async () => {
    const tenant = await createTenant(ds, 'RbacNoRole');
    const userId = await createUser(ds, tenant.id, 'norole@rbac.test');
    await rbac.provisionSystemRoles(tenant.id);
    await call(tenant.id, userId).expect(403);
  });
});
