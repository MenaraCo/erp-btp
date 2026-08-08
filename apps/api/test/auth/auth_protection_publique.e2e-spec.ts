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
import { AuthService } from '../../src/core/auth/auth.service';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser } from '../support/entitlements.helpers';

@Module({
  imports: [TypeOrmModule.forRoot(buildTypeOrmOptions('app')), TenancyModule, AuthModule],
})
class AuthTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

/**
 * Protection des routes VRAIMENT publiques.
 *
 * Connexion et inscription s'atteignent sans jeton ni tenant : ce sont les seules portes ouvertes
 * de l'application. Deux garde-corps y sont posés — la validation des entrées, qui refuse une
 * requête mal formée avant qu'elle n'atteigne la logique, et un plafond de débit, qui empêche
 * d'éprouver des mots de passe en boucle.
 */
describe('Auth — validation des entrées et plafond de débit', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantSlug: string;

  const login = (corps: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('Host', 'localhost')
      .set('X-Tenant-Slug', tenantSlug)
      .send(corps);

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({ imports: [AuthTestModule] }).compile();
    app = moduleRef.createNestApplication();
    applyGlobalPipes(app);
    await app.init();

    const tenant = await createTenant(ds, 'Protec');
    tenantSlug = tenant.slug;
    const userId = await createUser(ds, tenant.id, 'user@protec.test');
    await app.get(AuthService).setPassword(tenant.id, userId, 'MotDePasse!42');
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  describe('validation', () => {
    it('refuse une adresse e-mail qui n’en est pas une, en le disant', async () => {
      const r = await login({ email: 'pas-un-email', password: 'MotDePasse!42' }).expect(400);
      expect(JSON.stringify(r.body.message)).toContain('Adresse e-mail invalide');
    });

    it('refuse un mot de passe absent', async () => {
      const r = await login({ email: 'user@protec.test' }).expect(400);
      expect(JSON.stringify(r.body.message)).toContain('mot de passe est requis');
    });

    it("n'impose PAS de longueur minimale à la connexion", async () => {
      // Une règle de création de mot de passe n'a pas à être rejouée à l'entrée : elle
      // exclurait les comptes antérieurs et renseignerait un attaquant sur la politique.
      // Mot de passe court et faux : on attend un refus d'identifiants (401), pas un 400.
      await login({ email: 'user@protec.test', password: 'court' }).expect(401);
    });
  });

  describe('plafond de débit', () => {
    it('coupe après quelques tentatives répétées (429)', async () => {
      // Le plafond est de 5 par minute ; les essais ci-dessus en ont déjà consommé trois.
      const codes: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const r = await login({ email: 'user@protec.test', password: 'mauvais-mot-de-passe' });
        codes.push(r.status);
      }
      // Le dernier appel DOIT être bloqué : sans plafond, on essaierait des mots de passe sans fin.
      expect(codes).toContain(429);
      expect(codes[codes.length - 1]).toBe(429);
    });
  });
});
