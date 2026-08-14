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
import { RbacModule } from '../../src/core/rbac/rbac.module';
import { RbacService } from '../../src/core/rbac/rbac.service';
import { PaymentsModule } from '../../src/core/payments/payments.module';
import { FakePaymentProvider } from '../../src/core/payments/fake-payment.provider';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser } from '../support/entitlements.helpers';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
    TenancyModule,
    RbacModule,
    PaymentsModule,
  ],
})
class PaiementTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Comme en production : le webhook n'a pas de société, il en est exclu.
    consumer.apply(TenantMiddleware).exclude('webhooks/paiement').forRoutes('*');
  }
}

/**
 * Paiement des abonnements — session par redirection, puis webhook signé.
 *
 * Tout passe par l'implémentation de substitution : aucune clé, aucun appel réseau. Elle SIGNE
 * pourtant ses événements comme le vrai prestataire, de sorte que le chemin de vérification est
 * réellement éprouvé plutôt que contourné.
 *
 * Ce que ces tests verrouillent, ce sont les deux façons de perdre de l'argent ou la confiance :
 * un événement forgé qui activerait un abonnement sans paiement, et un événement rejoué qui le
 * prolongerait deux fois.
 */
describe('Abonnement — paiement par redirection et webhook', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  const SECRET = 'fake-webhook-secret';

  const envoyerWebhook = (corps: Record<string, unknown>, signature?: string) => {
    // On envoie la CHAÎNE, pas un Buffer : supertest re-sérialiserait ce dernier en
    // `{"type":"Buffer","data":[…]}` et la signature ne porterait plus sur les mêmes octets.
    const texte = JSON.stringify(corps);
    return request(app.getHttpServer())
      .post('/webhooks/paiement')
      .set('Host', 'localhost')
      .set('Content-Type', 'application/json')
      .set('x-signature', signature ?? FakePaymentProvider.signer(Buffer.from(texte), SECRET))
      .send(texte);
  };

  const statut = async (): Promise<string> =>
    (await runInTenant(ds, tenantId, (em) =>
      em.query(`SELECT status FROM subscription WHERE tenant_id = $1`, [tenantId]),
    ))[0].status;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({ imports: [PaiementTestModule] }).compile();
    // `rawBody` comme en production : la signature porte sur les octets reçus.
    app = moduleRef.createNestApplication({ rawBody: true });
    applyGlobalPipes(app);
    await app.init();

    const tenant = await createTenant(ds, 'Pay');
    tenantId = tenant.id;
    userId = await createUser(ds, tenantId, 'admin@pay.test');
    await app.get(RbacService).provisionSystemRoles(tenantId);
    await app.get(RbacService).assignRole(tenantId, userId, 'admin');
    await runInTenant(ds, tenantId, (em) =>
      em.query(`INSERT INTO subscription (tenant_id, status) VALUES ($1, 'trialing')`, [tenantId]),
    );
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  describe('montant à payer', () => {
    const appel = (method: 'get' | 'post', path: string) =>
      request(app.getHttpServer())[method](path)
        .set('Host', 'localhost')
        .set('X-Tenant-Id', tenantId)
        .set('X-User-Id', userId);

    it('refuse d’ouvrir une page de paiement tant qu’aucune formule n’est choisie', async () => {
      // Rien à prélever : mieux vaut le dire que rediriger vers une page à zéro euro.
      const r = await appel('post', '/abonnement/paiement/session').expect(400);
      expect(JSON.stringify(r.body.message)).toContain('formule');
    });

    it('dit POURQUOI il n’y a rien à payer, plutôt que de renvoyer une erreur', async () => {
      // Consulter son montant n'est pas une opération qui échoue : l'écran doit pouvoir
      // afficher une phrase, pas un rouge d'erreur.
      const r = await appel('get', '/abonnement/paiement/devis').expect(200);
      expect(r.body.devis).toBeNull();
      expect(r.body.motif).toContain('formule');
    });

    it('calcule le montant DEPUIS la souscription, jamais depuis le navigateur', async () => {
      // Essentiel à 39 €/siège/mois, 3 sièges ⇒ 117 € = 11 700 centimes.
      await request(app.getHttpServer())
        .post('/subscription/pack')
        .set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId)
        .send({ packCode: 'essentiel', seats: 3 })
        .expect(201);

      const r = await appel('get', '/abonnement/paiement/devis').expect(200);
      expect(r.body.devis.montantCentimes).toBe(11700);
      expect(r.body.devis.periode).toBe('month');
      expect(r.body.fictif).toBe(true);
    });

    it('ignore un montant soufflé dans la requête — sinon on s’abonnerait à un centime', async () => {
      const r = await request(app.getHttpServer())
        .post('/abonnement/paiement/session')
        .set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId)
        .send({ montantCentimes: 1, intitule: 'Cadeau', periode: 'month' })
        .expect(201);
      expect(r.body.devis.montantCentimes).toBe(11700);
      expect(r.body.url).toContain('http');
      expect(r.body.sessionId).toBeTruthy();
    });

    it("ne change RIEN à l'abonnement : seul le webhook fait foi", async () => {
      // Un client qui abandonne la page de paiement ne doit pas repartir abonné.
      expect(await statut()).toBe('trialing');
    });
  });

  describe('banc d’essai (prestataire de substitution)', () => {
    const simuler = (type: string) =>
      request(app.getHttpServer())
        .post('/abonnement/paiement/simuler')
        .set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId)
        .send({ type });

    it('active l’abonnement comme le ferait un vrai retour de paiement', async () => {
      const r = await simuler('paiement_reussi').expect(201);
      expect(r.body.applique).toBe(true);
      expect(await statut()).toBe('active');
    });

    it('passe la signature comme les autres : l’événement est journalisé', async () => {
      const [n] = await ds.query(
        `SELECT count(*)::int AS n FROM payment_event
          WHERE tenant_id = $1 AND provider_event_id LIKE 'fake_evt_%'`,
        [tenantId],
      );
      expect(n.n).toBeGreaterThan(0);
    });

    it('refuse un type d’événement inventé', async () => {
      await simuler('paiement_magique').expect(400);
    });

    it('n’existe pas en production, même avec le faux prestataire', async () => {
      const avant = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await simuler('paiement_reussi').expect(403);
      } finally {
        process.env.NODE_ENV = avant;
      }
      // Le raccourci est resté fermé : l'abonnement n'a pas bougé.
      expect(await statut()).toBe('active');
    });

    it('remet l’abonnement en essai pour la suite des tests', async () => {
      await runInTenant(ds, tenantId, (em) =>
        em.query(`UPDATE subscription SET status = 'trialing' WHERE tenant_id = $1`, [tenantId]));
      expect(await statut()).toBe('trialing');
    });
  });

  describe('webhook', () => {
    it('refuse un événement non signé — sinon activer un abonnement serait gratuit', async () => {
      await envoyerWebhook(
        { id: 'evt_forge', type: 'paiement_reussi', tenantId },
        'signature-bidon',
      ).expect(401);
      expect(await statut()).toBe('trialing');
    });

    it('active l’abonnement sur un paiement réussi', async () => {
      const fin = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      const r = await envoyerWebhook({
        id: 'evt_1', type: 'paiement_reussi', tenantId,
        providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_1', periodeFin: fin,
      }).expect(201);
      expect(r.body.applique).toBe(true);
      expect(await statut()).toBe('active');

      const [abo] = await runInTenant(ds, tenantId, (em) =>
        em.query(
          `SELECT provider_customer_id, provider_subscription_id, current_period_end
             FROM subscription WHERE tenant_id = $1`,
          [tenantId],
        ));
      expect(abo.provider_customer_id).toBe('cus_1');
      expect(abo.provider_subscription_id).toBe('sub_1');
      expect(abo.current_period_end).not.toBeNull();
    });

    it('ignore un événement REJOUÉ — le prestataire renvoie en cas de doute', async () => {
      const fin = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
      const [avant] = await runInTenant(ds, tenantId, (em) =>
        em.query(`SELECT current_period_end FROM subscription WHERE tenant_id = $1`, [tenantId]));

      // Même identifiant d'événement, période plus lointaine : s'il était rejoué, l'abonnement
      // se prolongerait indûment.
      const r = await envoyerWebhook({
        id: 'evt_1', type: 'paiement_reussi', tenantId,
        providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_1', periodeFin: fin,
      }).expect(201);
      expect(r.body.applique).toBe(false);

      const [apres] = await runInTenant(ds, tenantId, (em) =>
        em.query(`SELECT current_period_end FROM subscription WHERE tenant_id = $1`, [tenantId]));
      expect(apres.current_period_end).toEqual(avant.current_period_end);
    });

    it('passe en impayé sur un échec, SANS couper l’accès', async () => {
      await envoyerWebhook({ id: 'evt_2', type: 'paiement_echoue', tenantId }).expect(201);
      // « past_due » et non « canceled » : une carte expirée est un incident courant, fermer le
      // chantier du client pour cela serait disproportionné.
      expect(await statut()).toBe('past_due');
    });

    it('résilie sur annulation chez le prestataire', async () => {
      await envoyerWebhook({ id: 'evt_3', type: 'abonnement_annule', tenantId }).expect(201);
      expect(await statut()).toBe('canceled');
    });

    it('accuse réception d’un événement hors de notre champ sans rien changer', async () => {
      const r = await envoyerWebhook({ id: 'evt_4', type: 'facture_brouillon', tenantId }).expect(201);
      expect(r.body.type).toBe('ignore');
      expect(await statut()).toBe('canceled');
    });

    it('journalise chaque événement reçu, avec son corps', async () => {
      const lignes = await ds.query(
        `SELECT provider_event_id, type FROM payment_event
          WHERE tenant_id = $1 AND provider_event_id LIKE 'evt\\_%'
          ORDER BY provider_event_id`,
        [tenantId],
      );
      expect(lignes.map((l: { provider_event_id: string }) => l.provider_event_id))
        .toEqual(['evt_1', 'evt_2', 'evt_3', 'evt_4']);
    });
  });

  // Le code promo enregistré sur la souscription doit peser sur le devis vu ET payé par le client,
  // au même titre que dans le back-office éditeur. Régression : le devis client affichait le tarif
  // plein alors que l'éditeur montrait déjà le prix remisé.
  describe('code promo', () => {
    const appel = (method: 'get' | 'post', path: string) =>
      request(app.getHttpServer())[method](path)
        .set('Host', 'localhost')
        .set('X-Tenant-Id', tenantId)
        .set('X-User-Id', userId);

    it('applique la remise du code promo au devis client (117 € − 20 % = 93,60 €)', async () => {
      // La souscription porte déjà le pack essentiel × 3 = 117 €/mois (test précédent).
      const [pc] = await ds.query(
        `INSERT INTO promo_code (code, discount_type, discount_value, active)
         VALUES ('TEST20', 'percent', 20, true) RETURNING id`,
      );
      await runInTenant(ds, tenantId, (em) =>
        em.query(`UPDATE subscription SET promo_code_id = $2 WHERE tenant_id = $1`, [tenantId, pc.id]),
      );

      const r = await appel('get', '/abonnement/paiement/devis').expect(200);
      const d = r.body.devis;
      expect(d.mensuelBase).toBe(117);
      expect(d.promoCode).toEqual({ code: 'TEST20', discountType: 'percent', discountValue: 20 });
      expect(d.mensuelApresEngagement).toBe(117); // pas d'engagement annuel ici
      expect(d.mensuelNet).toBe(93.6);
      expect(d.montantCentimes).toBe(9360);
    });

    it('retirer le code promo redonne le tarif plein', async () => {
      await runInTenant(ds, tenantId, (em) =>
        em.query(`UPDATE subscription SET promo_code_id = NULL WHERE tenant_id = $1`, [tenantId]),
      );
      const r = await appel('get', '/abonnement/paiement/devis').expect(200);
      expect(r.body.devis.promoCode).toBeNull();
      expect(r.body.devis.mensuelNet).toBe(117);
      expect(r.body.devis.montantCentimes).toBe(11700);
    });
  });
});
