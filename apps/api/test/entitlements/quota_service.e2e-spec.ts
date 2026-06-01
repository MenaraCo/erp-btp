import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { EntitlementsModule } from '../../src/core/entitlements/entitlements.module';
import { QuotaService } from '../../src/core/entitlements/quota.service';
import { QuotaExceededException } from '../../src/core/entitlements/quota-exceeded.exception';
import { createTestDataSource, createTenant } from '../support/datasource';
import { setQuota } from '../support/entitlements.helpers';

describe('Quotas — vérification avant création', () => {
  let app: INestApplication;
  let ds: DataSource;
  let quota: QuotaService;

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
    quota = app.get(QuotaService);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('passe tant que la limite n’est pas atteinte, échoue au dépassement', async () => {
    const tenant = await createTenant(ds, 'Quota');
    await setQuota(ds, tenant.id, 'max_active_projects', 2);

    await expect(
      quota.assertWithinQuota(tenant.id, 'max_active_projects'),
    ).resolves.toBeUndefined();
    await quota.incrementUsage(tenant.id, 'max_active_projects');
    await quota.incrementUsage(tenant.id, 'max_active_projects');

    // current = 2, limit = 2 -> next creation would exceed.
    await expect(
      quota.assertWithinQuota(tenant.id, 'max_active_projects'),
    ).rejects.toBeInstanceOf(QuotaExceededException);
  });

  it('traite une métrique sans limite configurée comme illimitée', async () => {
    const tenant = await createTenant(ds, 'NoQuota');
    await expect(
      quota.assertWithinQuota(tenant.id, 'storage_gb', 9999),
    ).resolves.toBeUndefined();
  });
});
