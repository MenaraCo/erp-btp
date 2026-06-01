import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { EntitlementsModule } from '../../src/core/entitlements/entitlements.module';
import { EntitlementsService } from '../../src/core/entitlements/entitlements.service';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser, activateModule } from '../support/entitlements.helpers';

describe('Jetons — affectés ≤ achetés', () => {
  let app: INestApplication;
  let ds: DataSource;
  let service: EntitlementsService;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
        TenancyModule,
        CatalogModule,
        EntitlementsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(EntitlementsService);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('autorise l’affectation jusqu’au nombre de jetons achetés, puis refuse', async () => {
    const tenant = await createTenant(ds, 'Seats');
    await activateModule(ds, tenant.id, 'estimating', 1); // a single seat purchased
    const u1 = await createUser(ds, tenant.id, 'u1@seats.test');
    const u2 = await createUser(ds, tenant.id, 'u2@seats.test');

    await expect(
      service.assignSeat(tenant.id, 'estimating', u1),
    ).resolves.toBeUndefined();

    // No seats left -> the 2nd assignment is rejected.
    await expect(
      service.assignSeat(tenant.id, 'estimating', u2),
    ).rejects.toThrow();
  });

  it('refuse l’affectation d’un module non actif pour le tenant', async () => {
    const tenant = await createTenant(ds, 'SeatsNoModule');
    const u = await createUser(ds, tenant.id, 'u@seatsnomodule.test');
    await expect(service.assignSeat(tenant.id, 'invoicing', u)).rejects.toThrow();
  });
});
