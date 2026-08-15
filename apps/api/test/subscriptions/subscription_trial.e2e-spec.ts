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
import { MODULES } from '../../src/core/catalog/catalog.config';
import { PricingService } from '../../src/core/pricing/pricing.service';
import { createTestDataSource, createTenant } from '../support/datasource';

describe('Souscription — essai 30 jours, tous les modules', () => {
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

  it('l’essai donne accès à TOUS les modules avec un statut trialing', async () => {
    const tenant = await createTenant(ds, 'Trial');
    await subscriptions.startTrial(tenant.id);

    const sub = await subscriptions.getSubscription(tenant.id);
    expect(sub?.status).toBe('trialing');
    expect(sub?.trialEndsAt).toBeTruthy();
    // trial_ends_at is roughly 30 days in the future
    const days = (new Date(sub!.trialEndsAt!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);

    const active = await entitlements.getActiveModuleCodes(tenant.id);
    expect(active.sort()).toEqual(MODULES.map((m) => m.code).sort());
  });

  it('la durée de l’essai suit le réglage de l’éditeur', async () => {
    // Levier commercial : allonger l'essai pour une campagne, sans redéploiement.
    const pricing = app.get(PricingService);
    await pricing.setTrialDays(45);
    try {
      const tenant = await createTenant(ds, 'TrialRegle');
      await subscriptions.startTrial(tenant.id);
      const sub = await subscriptions.getSubscription(tenant.id);
      const days = (new Date(sub!.trialEndsAt!).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(44);
      expect(days).toBeLessThan(46);
    } finally {
      // On rend la valeur par défaut aux autres tests.
      await pricing.setTrialDays(30);
    }
  });

  it('refuse une durée d’essai aberrante', async () => {
    const pricing = app.get(PricingService);
    await expect(pricing.setTrialDays(0)).rejects.toThrow(/1 et 365/);
    await expect(pricing.setTrialDays(400)).rejects.toThrow(/1 et 365/);
  });

  it('démarrer l’essai deux fois est refusé', async () => {
    const tenant = await createTenant(ds, 'TrialTwice');
    await subscriptions.startTrial(tenant.id);
    await expect(subscriptions.startTrial(tenant.id)).rejects.toThrow();
  });
});
