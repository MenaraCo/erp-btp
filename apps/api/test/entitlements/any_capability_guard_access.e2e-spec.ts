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
import { RequiresAnyCapability } from '../../src/core/entitlements/requires-any-capability.decorator';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser, activateModule } from '../support/entitlements.helpers';

/**
 * L'acceptation de commande est la charnière étude → exécution : elle doit s'ouvrir dès que
 * l'on facture OU que l'on suit des chantiers, et rester fermée sans aucun des deux.
 */
@Controller('protected')
class AnyCapController {
  @Get('acceptance')
  @RequiresAnyCapability('invoicing.situations', 'site_tracking.budget')
  acceptance() {
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
  controllers: [AnyCapController],
})
class AnyCapModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

describe('RequiresAnyCapability — accès ouvert par facturation OU suivi de chantier', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({ imports: [AnyCapModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  function call(tenantId: string, userId?: string) {
    const req = request(app.getHttpServer())
      .get('/protected/acceptance')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', tenantId);
    return userId ? req.set('X-User-Id', userId) : req;
  }

  async function grant(name: string, moduleCode: string) {
    const tenant = await createTenant(ds, name);
    const userId = await createUser(ds, tenant.id, `u@${name.toLowerCase()}.test`);
    await activateModule(ds, tenant.id, moduleCode, 2);
    await app.get(EntitlementsService).assignSeat(tenant.id, moduleCode, userId);
    return { tenant, userId };
  }

  it('ouvre l’accès avec la FACTURATION seule', async () => {
    const { tenant, userId } = await grant('AnyInvoicing', 'invoicing');
    const res = await call(tenant.id, userId).expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('ouvre l’accès avec le SUIVI DE CHANTIER seul', async () => {
    const { tenant, userId } = await grant('AnySiteTracking', 'site_tracking');
    const res = await call(tenant.id, userId).expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('refuse (403) quand aucun des deux modules n’est souscrit', async () => {
    const tenant = await createTenant(ds, 'AnyNone');
    const userId = await createUser(ds, tenant.id, 'u@anynone.test');
    await activateModule(ds, tenant.id, 'estimating', 2); // étude seule : sans objet ici
    await app.get(EntitlementsService).assignSeat(tenant.id, 'estimating', userId);
    await call(tenant.id, userId).expect(403);
  });

  it('refuse (403) quand le module est actif mais l’utilisateur n’a pas de jeton', async () => {
    const tenant = await createTenant(ds, 'AnyNoSeat');
    const userId = await createUser(ds, tenant.id, 'u@anynoseat.test');
    await activateModule(ds, tenant.id, 'invoicing', 2); // actif, mais aucun jeton affecté
    await call(tenant.id, userId).expect(403);
  });
});
