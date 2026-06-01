import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { EntitlementsModule } from '../../src/core/entitlements/entitlements.module';
import { EntitlementsService } from '../../src/core/entitlements/entitlements.service';
import { SubscriptionsModule } from '../../src/core/subscriptions/subscriptions.module';
import { SubscriptionService } from '../../src/core/subscriptions/subscription.service';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser } from '../support/entitlements.helpers';

describe('Souscription — fin d’essai : lecture seule, jamais de suppression', () => {
  let app: INestApplication;
  let ds: DataSource;
  let subscriptions: SubscriptionService;
  let entitlements: EntitlementsService;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
        TenancyModule,
        CatalogModule,
        EntitlementsModule,
        SubscriptionsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    subscriptions = app.get(SubscriptionService);
    entitlements = app.get(EntitlementsService);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('à l’échéance, les modules passent en lecture seule et les données sont conservées', async () => {
    const tenant = await createTenant(ds, 'Expiring');
    await subscriptions.startTrial(tenant.id);
    const userId = await createUser(ds, tenant.id, 'keep@expiring.test');

    // Force the trial to have ended yesterday.
    await runInTenant(ds, tenant.id, (em) =>
      em.query(
        `UPDATE subscription SET trial_ends_at = now() - interval '1 day' WHERE tenant_id = $1`,
        [tenant.id],
      ),
    );

    const result = await subscriptions.applyExpiryIfDue(tenant.id);
    expect(result.changed).toBe(true);

    // No module is active anymore (write capabilities revoked).
    const active = await entitlements.getActiveModuleCodes(tenant.id);
    expect(active).toEqual([]);

    const sub = await subscriptions.getSubscription(tenant.id);
    expect(sub?.status).toBe('past_due');

    // Data is preserved: the user still exists, and the modules are kept read-only.
    const users = await runInTenant(ds, tenant.id, (em) =>
      em.query(`SELECT id FROM user_account WHERE id = $1`, [userId]),
    );
    expect(users).toHaveLength(1);
    const readOnly = await runInTenant(ds, tenant.id, (em) =>
      em.query(
        `SELECT count(*)::int AS n FROM tenant_module WHERE read_only = true AND active = false`,
      ),
    );
    expect(readOnly[0].n).toBeGreaterThan(0);
  });

  it('applyExpiryIfDue est idempotent (rien à faire si non échu)', async () => {
    const tenant = await createTenant(ds, 'NotDue');
    await subscriptions.startTrial(tenant.id);
    const result = await subscriptions.applyExpiryIfDue(tenant.id);
    expect(result.changed).toBe(false);
  });
});
