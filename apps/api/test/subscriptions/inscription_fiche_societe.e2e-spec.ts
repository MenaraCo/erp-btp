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
import { createTestDataSource } from '../support/datasource';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
    TenancyModule,
    CatalogModule,
    EntitlementsModule,
    AuthModule,
  ],
})
class InscriptionFicheModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).exclude('auth/(.*)').forRoutes('*');
  }
}

/**
 * Ce qui est saisi à l'inscription doit se retrouver dans la fiche société.
 *
 * Auparavant, l'identité administrative reprise de l'annuaire officiel (SIREN, forme juridique,
 * adresse…) était jetée : la fiche naissait vide au premier passage dans Paramètres, et le client
 * ressaisissait ce qu'il venait de donner. Or devis et factures s'appuient sur cette fiche.
 */
describe('Inscription — l’identité de la société est reprise dans sa fiche', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({
      imports: [InscriptionFicheModule],
    }).compile();
    app = moduleRef.createNestApplication();
    applyGlobalPipes(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('reporte les informations administratives et la fonction du créateur', async () => {
    const suffixe = Math.floor(Date.now() % 1e9).toString(36);
    const r = await request(app.getHttpServer())
      .post('/auth/register')
      .set('Host', 'localhost')
      .send({
        companyName: `Bâtisseurs ${suffixe}`,
        jobTitle: 'Gérant',
        firstName: 'Marie',
        lastName: 'Durand',
        email: `marie-${suffixe}@fiche.test`,
        password: 'motdepasse1',
        mode: 'trial',
        company: {
          siren: '123456789',
          siret: '12345678900012',
          legalForm: 'SARL',
          address: '12 rue des Bâtisseurs',
          postalCode: '75011',
          city: 'Paris',
          vatIntra: 'FR00123456789',
          phone: '0123456789',
        },
      })
      .expect(201);

    const tenantId = r.body.tenantId as string;

    const [societe] = await runInTenant(ds, tenantId, (em) =>
      em.query(
        `SELECT name, siren, siret, legal_form, address, postal_code, city, vat_intra, phone, email
           FROM company WHERE tenant_id = $1`,
        [tenantId],
      ),
    );
    expect(societe).toMatchObject({
      name: `Bâtisseurs ${suffixe}`,
      siren: '123456789',
      siret: '12345678900012',
      legal_form: 'SARL',
      address: '12 rue des Bâtisseurs',
      postal_code: '75011',
      city: 'Paris',
      vat_intra: 'FR00123456789',
      phone: '0123456789',
      email: `marie-${suffixe}@fiche.test`,
    });

    // Les préférences accompagnent la fiche (couleurs, taux par défaut, numérotation).
    const [prefs] = await runInTenant(ds, tenantId, (em) =>
      em.query(`SELECT id FROM company_preferences WHERE tenant_id = $1`, [tenantId]),
    );
    expect(prefs).toBeTruthy();

    // La fonction du créateur est conservée sur son compte.
    const [user] = await runInTenant(ds, tenantId, (em) =>
      em.query(`SELECT job_title FROM user_account WHERE tenant_id = $1`, [tenantId]),
    );
    expect(user.job_title).toBe('Gérant');
  });

  it('crée quand même la fiche quand rien d’administratif n’est fourni', async () => {
    const suffixe = Math.floor((Date.now() + 1) % 1e9).toString(36);
    const r = await request(app.getHttpServer())
      .post('/auth/register')
      .set('Host', 'localhost')
      .send({
        companyName: `Minimal ${suffixe}`,
        firstName: 'Paul',
        lastName: 'Martin',
        email: `paul-${suffixe}@fiche.test`,
        password: 'motdepasse1',
        mode: 'trial',
      })
      .expect(201);

    const [societe] = await runInTenant(ds, r.body.tenantId, (em) =>
      em.query(`SELECT name, siren FROM company WHERE tenant_id = $1`, [r.body.tenantId]),
    );
    // Le nom vient du formulaire, le reste attend d'être complété dans Paramètres.
    expect(societe.name).toBe(`Minimal ${suffixe}`);
    expect(societe.siren).toBeNull();
  });
});
