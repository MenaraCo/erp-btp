import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { createTestDataSource } from '../support/datasource';

@Module({
  imports: [TypeOrmModule.forRoot(buildTypeOrmOptions('app')), CatalogModule],
})
class PublicPromoModule {}

/**
 * Validation publique d'un code promo (écran d'inscription) : elle sert à MONTRER au visiteur la
 * remise avant paiement. Elle ne doit rien exposer d'autre que le type et la valeur, et seulement
 * pour un code réellement utilisable — un code inactif/expiré répond « inutilisable » sans détail.
 */
describe('Catalogue public — validation d’un code promo', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({ imports: [PublicPromoModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // La table promo_code est globale (pas de RLS) : insertion directe.
    await ds.query(
      `INSERT INTO promo_code (code, discount_type, discount_value, active)
       VALUES ('PUB15', 'percent', 15, true)
       ON CONFLICT (code) DO UPDATE SET active = true, discount_value = 15`,
    );
    await ds.query(
      `INSERT INTO promo_code (code, discount_type, discount_value, active)
       VALUES ('PUBOFF', 'percent', 20, false)
       ON CONFLICT (code) DO UPDATE SET active = false`,
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM promo_code WHERE code IN ('PUB15', 'PUBOFF')`);
    await app.close();
    await ds.destroy();
  });

  const get = (code: string) =>
    request(app.getHttpServer()).get(`/public/catalog/promo/${code}`).set('Host', 'localhost');

  it('renvoie la remise d’un code utilisable, et rien de plus', async () => {
    const r = await get('PUB15').expect(200);
    expect(r.body).toEqual({
      code: 'PUB15',
      usable: true,
      discountType: 'percent',
      discountValue: 15,
      appliesTo: 'both',
    });
  });

  it('est insensible à la casse du code', async () => {
    const r = await get('pub15').expect(200);
    expect(r.body.usable).toBe(true);
    expect(r.body.discountValue).toBe(15);
  });

  it('répond « inutilisable » pour un code inactif, sans détailler la raison', async () => {
    const r = await get('PUBOFF').expect(200);
    expect(r.body).toEqual({ code: 'PUBOFF', usable: false });
    expect(r.body.discountValue).toBeUndefined();
  });

  it('répond « inutilisable » pour un code inconnu (pas d’erreur)', async () => {
    const r = await get('NEXISTEPAS').expect(200);
    expect(r.body.usable).toBe(false);
  });
});
