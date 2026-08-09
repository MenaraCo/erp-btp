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
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { PromoModule } from '../../src/core/promo/promo.module';
import { PricingModule } from '../../src/core/pricing/pricing.module';
import { EditorModule } from '../../src/core/editor/editor.module';
import { AuthTokenModule } from '../../src/core/auth/auth-token.module';
import { AuthTokenService } from '../../src/core/auth/auth-token.service';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser } from '../support/entitlements.helpers';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
    TenancyModule,
    CatalogModule,
    PromoModule,
    PricingModule,
    AuthTokenModule,
    EditorModule,
  ],
})
class EditeurTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

/**
 * Fiche d'un abonné, et suppression.
 *
 * L'éditeur a besoin de voir qui est réellement derrière une société — identité administrative,
 * contacts — et de pouvoir faire le ménage des comptes d'essai abandonnés.
 *
 * La suppression est IRRÉVERSIBLE : 58 tables partent en cascade. Ces tests verrouillent les deux
 * garde-fous qui empêchent le geste malheureux.
 */
describe('Éditeur — fiche d’un abonné et suppression', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let slug: string;
  let adminId: string;
  let jeton: string;

  /**
   * L'éditeur s'authentifie par son E-MAIL (liste blanche), jamais par un rôle client. Or l'e-mail
   * ne parvient au contexte que par le JETON — l'en-tête de développement `X-User-Id` ne le porte
   * pas. Il faut donc un vrai jeton, comme en production.
   */
  const asEditeur = (method: 'get' | 'delete', path: string) =>
    request(app.getHttpServer())[method](path)
      .set('Host', 'localhost')
      .set('Authorization', `Bearer ${jeton}`);

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({ imports: [EditeurTestModule] }).compile();
    app = moduleRef.createNestApplication();
    applyGlobalPipes(app);
    await app.init();

    const tenant = await createTenant(ds, 'Fiche');
    tenantId = tenant.id;
    slug = tenant.slug;
    adminId = await createUser(ds, tenantId, 'admin@demo.test');
    jeton = app.get(AuthTokenService).issueAccessToken(adminId, tenantId, 'admin@demo.test');

    await runInTenant(ds, tenantId, async (em) => {
      await em.query(
        `INSERT INTO subscription (tenant_id, status) VALUES ($1, 'trialing')`,
        [tenantId],
      );
      await em.query(
        `INSERT INTO company (tenant_id, code, name, legal_form, siren, siret, vat_intra, city, email)
         VALUES ($1, 'PRINC', 'Bâti Sud', 'SARL', '812345678', '81234567800019',
                 'FR12812345678', 'Marseille', 'contact@bati-sud.fr')`,
        [tenantId],
      );
      await em.query(
        `INSERT INTO affaire (tenant_id, code, name, status) VALUES ($1, 'A1', 'Affaire test', 'en_cours')`,
        [tenantId],
      );
    });
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  describe('fiche', () => {
    it("montre l'identité administrative de la société", async () => {
      const f = (await asEditeur('get', `/editor/tenants/${tenantId}`).expect(200)).body;
      expect(f.tenant.slug).toBe(slug);
      const c = f.societes[0];
      expect(c.name).toBe('Bâti Sud');
      expect(c.siret).toBe('81234567800019');
      expect(c.vat_intra).toBe('FR12812345678');
      expect(c.legal_form).toBe('SARL');
      expect(c.city).toBe('Marseille');
    });

    it('montre les contacts, avec leurs rôles', async () => {
      const f = (await asEditeur('get', `/editor/tenants/${tenantId}`).expect(200)).body;
      expect(f.contacts.map((c: { email: string }) => c.email)).toContain('admin@demo.test');
    });

    it('montre le VOLUME produit — ce qu’une suppression détruirait', async () => {
      const f = (await asEditeur('get', `/editor/tenants/${tenantId}`).expect(200)).body;
      expect(f.volumes.affaires).toBe(1);
      expect(f.volumes.utilisateurs).toBe(1);
      expect(f.abonnement.status).toBe('trialing');
    });

    it('renvoie 404 sur une société inconnue', async () => {
      await asEditeur('get', '/editor/tenants/00000000-0000-0000-0000-000000000000').expect(404);
    });
  });

  describe('suppression', () => {
    it('refuse sans la confirmation exacte du slug', async () => {
      const r = await request(app.getHttpServer())
        .delete(`/editor/tenants/${tenantId}`)
        .set('Host', 'localhost').set('Authorization', `Bearer ${jeton}`)
        .send({ confirmationSlug: 'pas-le-bon' })
        .expect(400);
      expect(r.body.message).toContain(slug);

      // Rien n'a bougé : c'est tout l'objet de la friction.
      await asEditeur('get', `/editor/tenants/${tenantId}`).expect(200);
    });

    it('refuse de supprimer une société dont l’abonnement est ACTIF', async () => {
      await runInTenant(ds, tenantId, (em) =>
        em.query(`UPDATE subscription SET status = 'active' WHERE tenant_id = $1`, [tenantId]));

      const r = await request(app.getHttpServer())
        .delete(`/editor/tenants/${tenantId}`)
        .set('Host', 'localhost').set('Authorization', `Bearer ${jeton}`)
        .send({ confirmationSlug: slug })
        .expect(409);
      expect(r.body.message).toContain('ACTIF');
    });

    it("supprime un abonné actif SI la résiliation est demandée explicitement", async () => {
      // L'abonnement est encore « active » (test précédent). Le refus ne doit pas être un mur :
      // l'éditeur peut assumer les deux gestes d'un coup, plutôt que d'aller résilier ailleurs.
      const jetable = await createTenant(ds, 'Force');
      await runInTenant(ds, jetable.id, (em) =>
        em.query(`INSERT INTO subscription (tenant_id, status) VALUES ($1, 'active')`, [jetable.id]));

      await request(app.getHttpServer())
        .delete(`/editor/tenants/${jetable.id}`)
        .set('Host', 'localhost').set('Authorization', `Bearer ${jeton}`)
        .send({ confirmationSlug: jetable.slug, resilierDabord: true })
        .expect(200);

      const [t] = await ds.query(`SELECT count(*)::int AS n FROM tenant WHERE id = $1`, [jetable.id]);
      expect(t.n).toBe(0);
    });

    it("mais le slug reste exigé, même en résiliant d'office", async () => {
      const jetable = await createTenant(ds, 'Force2');
      await runInTenant(ds, jetable.id, (em) =>
        em.query(`INSERT INTO subscription (tenant_id, status) VALUES ($1, 'active')`, [jetable.id]));

      await request(app.getHttpServer())
        .delete(`/editor/tenants/${jetable.id}`)
        .set('Host', 'localhost').set('Authorization', `Bearer ${jeton}`)
        .send({ confirmationSlug: 'nimporte-quoi', resilierDabord: true })
        .expect(400);

      const [t] = await ds.query(`SELECT count(*)::int AS n FROM tenant WHERE id = $1`, [jetable.id]);
      expect(t.n).toBe(1);
    });

    it('supprime définitivement, en emportant tout le contenu', async () => {
      await runInTenant(ds, tenantId, (em) =>
        em.query(`UPDATE subscription SET status = 'canceled' WHERE tenant_id = $1`, [tenantId]));

      await request(app.getHttpServer())
        .delete(`/editor/tenants/${tenantId}`)
        .set('Host', 'localhost').set('Authorization', `Bearer ${jeton}`)
        .send({ confirmationSlug: slug })
        .expect(200);

      // La cascade a bien emporté le contenu, pas seulement la ligne `tenant`.
      const [t] = await ds.query(`SELECT count(*)::int AS n FROM tenant WHERE id = $1`, [tenantId]);
      const [a] = await ds.query(`SELECT count(*)::int AS n FROM affaire WHERE tenant_id = $1`, [tenantId]);
      const [u] = await ds.query(`SELECT count(*)::int AS n FROM user_account WHERE tenant_id = $1`, [tenantId]);
      expect([t.n, a.n, u.n]).toEqual([0, 0, 0]);
    });
  });
});
