import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { EntitlementsModule } from '../../src/core/entitlements/entitlements.module';
import { AuthModule } from '../../src/core/auth/auth.module';
import { AuthService } from '../../src/core/auth/auth.service';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser } from '../support/entitlements.helpers';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
    TenancyModule,
    CatalogModule,
    EntitlementsModule,
    AuthModule,
  ],
})
class CompaniesModule {}

describe('Auth — annuaire des sociétés par e-mail (companies_for_email)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let auth: AuthService;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({
      imports: [CompaniesModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    auth = app.get(AuthService);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('renvoie TOUTES les sociétés d’un e-mail partagé, malgré la RLS FORCÉE', async () => {
    // Le même e-mail dans deux sociétés distinctes : la fonction SECURITY DEFINER doit franchir la
    // RLS et renvoyer les deux. C'est précisément ce qui permet à l'écran de connexion de proposer
    // le bon choix sans que l'utilisateur retape un slug.
    const suffix = Math.floor(Date.now() % 1e9).toString(36);
    const email = `partage-${suffix}@test.example`;
    const a = await createTenant(ds, `Alpha ${suffix}`);
    const b = await createTenant(ds, `Beta ${suffix}`);
    const other = await createTenant(ds, `Gamma ${suffix}`);
    await createUser(ds, a.id, email);
    await createUser(ds, b.id, email);
    await createUser(ds, other.id, `quelquun-${suffix}@test.example`);

    const found = await auth.companiesForEmail(email);
    const slugs = found.map((c) => c.slug).sort();
    expect(slugs).toEqual([a.slug, b.slug].sort());
    // Le nom de la société est bien exposé (pour l'affichage dans la liste), jamais autre chose.
    expect(found.every((c) => typeof c.name === 'string' && c.name.length > 0)).toBe(true);
  });

  it('est insensible à la casse de l’e-mail', async () => {
    const suffix = Math.floor((Date.now() + 1) % 1e9).toString(36);
    const email = `Casse-${suffix}@Test.Example`;
    const t = await createTenant(ds, `Casse ${suffix}`);
    await createUser(ds, t.id, email);

    const found = await auth.companiesForEmail(email.toUpperCase());
    expect(found.map((c) => c.slug)).toContain(t.slug);
  });

  it('renvoie une liste vide pour un e-mail inconnu (pas d’erreur)', async () => {
    const found = await auth.companiesForEmail('personne-introuvable@nowhere.test');
    expect(found).toEqual([]);
  });
});
