import {
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
import { applyGlobalPipes } from '../../src/core/common/global-pipes';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { TenantMiddleware } from '../../src/core/tenancy/tenant.middleware';
import { AuthModule } from '../../src/core/auth/auth.module';
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { EntitlementsModule } from '../../src/core/entitlements/entitlements.module';
import { PaymentsModule } from '../../src/core/payments/payments.module';
import { FakePaymentProvider } from '../../src/core/payments/fake-payment.provider';
import { createTestDataSource } from '../support/datasource';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
    TenancyModule,
    CatalogModule,
    EntitlementsModule,
    AuthModule,
    PaymentsModule,
  ],
})
class InscriptionTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Comme en production : ni l'inscription ni le webhook n'ont de société.
    consumer.apply(TenantMiddleware).exclude('auth/(.*)', 'webhooks/paiement').forRoutes('*');
  }
}

/**
 * Porte 2 — « Choisir mon abonnement » : le paiement précède l'accès.
 *
 * C'est la règle que ces tests verrouillent, et elle vaut de l'argent : sans elle, remplir le
 * formulaire d'inscription suffisait à repartir avec un compte payant, tous modules ouverts,
 * sans qu'un centime ait été encaissé. L'écran de paiement n'était qu'un décor.
 *
 * La porte 1 (essai gratuit) n'est pas concernée : elle ouvre tout, c'est sa raison d'être.
 */
describe('Inscription porte 2 — les modules attendent le premier paiement', () => {
  let app: INestApplication;
  let ds: DataSource;

  const SECRET = 'fake-webhook-secret';

  const inscrire = (corps: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/register').set('Host', 'localhost').send(corps);

  const payer = (tenantId: string) => {
    const texte = JSON.stringify({
      id: `evt_${tenantId.slice(0, 8)}`,
      type: 'paiement_reussi',
      tenantId,
      providerCustomerId: 'cus_x',
      providerSubscriptionId: 'sub_x',
      periodeFin: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    return request(app.getHttpServer())
      .post('/webhooks/paiement')
      .set('Host', 'localhost')
      .set('Content-Type', 'application/json')
      .set('x-signature', FakePaymentProvider.signer(Buffer.from(texte), SECRET))
      .send(texte);
  };

  const etat = (tenantId: string) =>
    runInTenant(ds, tenantId, async (em) => {
      const [sub] = await em.query(
        `SELECT status FROM subscription WHERE tenant_id = $1`,
        [tenantId],
      );
      // RLS restreint déjà à la société courante : pas de filtre explicite à passer.
      const modules = await em.query(`SELECT module_code, active FROM tenant_module ORDER BY module_code`);
      const [jetons] = await em.query(
        `SELECT count(*)::int AS n FROM seat_assignment WHERE tenant_id = $1`,
        [tenantId],
      );
      return {
        status: sub?.status as string,
        ouverts: modules.filter((m: { active: boolean }) => m.active).length,
        jetons: Number(jetons.n),
      };
    });

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({ imports: [InscriptionTestModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    applyGlobalPipes(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('crée le compte mais laisse les modules FERMÉS tant que rien n’est payé', async () => {
    const r = await inscrire({
      companyName: 'Toits du Sud',
      fullName: 'Claire Roux',
      email: 'claire@toits-du-sud.fr',
      password: 'motdepasse1',
      mode: 'direct',
      packCode: 'essentiel',
      packSeats: 2,
      billingTerm: 'monthly',
      billingInterval: 'monthly',
    }).expect(201);

    const e = await etat(r.body.tenantId);
    expect(e.status).toBe('incomplete');
    expect(e.ouverts).toBe(0);
    // Aucun jeton non plus : sinon l'accès serait ouvert par la bande.
    expect(e.jetons).toBe(0);
    // Le compte existe bel et bien — c'est l'accès qui attend, pas l'inscription.
    expect(r.body.accessToken).toBeTruthy();
  });

  it('ouvre les modules et donne un jeton au fondateur dès le paiement encaissé', async () => {
    const r = await inscrire({
      companyName: 'Charpentes Vidal',
      fullName: 'Marc Vidal',
      email: 'marc@charpentes-vidal.fr',
      password: 'motdepasse1',
      mode: 'direct',
      packCode: 'essentiel',
      packSeats: 2,
      billingTerm: 'monthly',
      billingInterval: 'monthly',
    }).expect(201);
    const tenantId = r.body.tenantId as string;

    expect((await etat(tenantId)).ouverts).toBe(0);

    await payer(tenantId).expect(201);

    const e = await etat(tenantId);
    expect(e.status).toBe('active');
    expect(e.ouverts).toBeGreaterThan(0);
    // Le client vient de payer : il ne doit pas trouver une application vide.
    expect(e.jetons).toBe(e.ouverts);
  });

  it('la porte 1 reste un essai immédiat : l’essai n’attend aucun paiement', async () => {
    const r = await inscrire({
      companyName: 'Peintures Lodi',
      fullName: 'Ana Lodi',
      email: 'ana@peintures-lodi.fr',
      password: 'motdepasse1',
      mode: 'trial',
    }).expect(201);

    const e = await etat(r.body.tenantId);
    expect(e.status).toBe('trialing');
    expect(e.ouverts).toBeGreaterThan(0);
  });
});
