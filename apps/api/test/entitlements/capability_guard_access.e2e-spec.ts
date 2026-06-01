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
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { EntitlementsModule } from '../../src/core/entitlements/entitlements.module';
import { EntitlementsService } from '../../src/core/entitlements/entitlements.service';
import { RequiresCapability } from '../../src/core/entitlements/requires-capability.decorator';
import {
  createTestDataSource,
  createTenant,
} from '../support/datasource';
import { createUser, activateModule } from '../support/entitlements.helpers';

@Controller('protected')
class ProtectedController {
  @Get('estimate')
  @RequiresCapability('estimating.bid')
  estimate() {
    return { ok: true };
  }
}

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
    TenancyModule,
    CatalogModule,
    EntitlementsModule,
  ],
  controllers: [ProtectedController],
})
class GatedModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

describe('CapabilityGuard — accès gaté (autorisé / refusé / sans jeton)', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({
      imports: [GatedModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  function callEstimate(tenantId: string, userId?: string) {
    const req = request(app.getHttpServer())
      .get('/protected/estimate')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', tenantId);
    return userId ? req.set('X-User-Id', userId) : req;
  }

  it('autorise quand le module est actif ET l’utilisateur a un jeton', async () => {
    const tenant = await createTenant(ds, 'Granted');
    const userId = await createUser(ds, tenant.id, 'u@granted.test');
    await activateModule(ds, tenant.id, 'estimating', 2);
    await app.get(EntitlementsService).assignSeat(tenant.id, 'estimating', userId);

    const res = await callEstimate(tenant.id, userId).expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('refuse (403) quand le module n’est pas actif pour le tenant', async () => {
    const tenant = await createTenant(ds, 'NoModule');
    const userId = await createUser(ds, tenant.id, 'u@nomodule.test');
    // module estimating NOT activated
    await callEstimate(tenant.id, userId).expect(403);
  });

  it('refuse (403) quand l’utilisateur n’a pas de jeton du module', async () => {
    const tenant = await createTenant(ds, 'NoSeat');
    const userId = await createUser(ds, tenant.id, 'u@noseat.test');
    await activateModule(ds, tenant.id, 'estimating', 2); // active but no seat assigned
    await callEstimate(tenant.id, userId).expect(403);
  });
});
