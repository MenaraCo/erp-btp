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
import { AuthModule } from '../../src/core/auth/auth.module';
import { applyGlobalPipes } from '../../src/core/common/global-pipes';
import { AuthService } from '../../src/core/auth/auth.service';
import { createTestDataSource, createTenant } from '../support/datasource';
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
    AuthModule,
  ],
  controllers: [ProtectedController],
})
class TokenAccessModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

describe('Auth — le token vérifié porte le contexte tenant + user', () => {
  let app: INestApplication;
  let ds: DataSource;
  let auth: AuthService;
  let entitlements: EntitlementsService;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({
      imports: [TokenAccessModule],
    }).compile();
    app = moduleRef.createNestApplication();
    applyGlobalPipes(app);
    await app.init();
    auth = app.get(AuthService);
    entitlements = app.get(EntitlementsService);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('un Bearer token valide donne accès SANS header X-Tenant-Id / X-User-Id', async () => {
    const tenant = await createTenant(ds, 'TokenAccess');
    const userId = await createUser(ds, tenant.id, 'user@token.test');
    await auth.setPassword(tenant.id, userId, 'S3cret!');
    await activateModule(ds, tenant.id, 'estimating', 2);
    await entitlements.assignSeat(tenant.id, 'estimating', userId);

    // Sans 2FA, le login renvoie toujours un jeton (pas de défi MFA).
    const { accessToken } = (await auth.login(
      tenant.id,
      'user@token.test',
      'S3cret!',
    )) as { accessToken: string };

    const res = await request(app.getHttpServer())
      .get('/protected/estimate')
      .set('Host', 'localhost')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejette (401) un token invalide', async () => {
    await request(app.getHttpServer())
      .get('/protected/estimate')
      .set('Host', 'localhost')
      .set('Authorization', 'Bearer not.a.token')
      .expect(401);
  });
});
