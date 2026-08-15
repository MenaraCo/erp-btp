import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { PromoModule } from '../../src/core/promo/promo.module';
import { PromoCodeService } from '../../src/core/promo/promo-code.service';
import { createTestDataSource } from '../support/datasource';

@Module({
  imports: [TypeOrmModule.forRoot(buildTypeOrmOptions('app')), PromoModule],
})
class PromoTestModule {}

/**
 * Écriture des codes promo depuis la console éditeur : portée (mensuel/annuel/les deux) et durée
 * de la remise (toute la période, ou seulement les N premiers mois). Ces deux réglages décident
 * de ce que le client paiera : ils doivent être persistés et relus fidèlement, et refuser
 * les valeurs aberrantes plutôt que de les enregistrer en silence.
 */
describe('Codes promo — portée et durée paramétrées par l’éditeur', () => {
  let app: INestApplication;
  let ds: DataSource;
  let promos: PromoCodeService;
  const CODES = ['DUREE2M', 'DUREENULL'];

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({ imports: [PromoTestModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    promos = app.get(PromoCodeService);
    await ds.query(`DELETE FROM promo_code WHERE code = ANY($1)`, [CODES]);
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM promo_code WHERE code = ANY($1)`, [CODES]);
    await app.close();
    await ds.destroy();
  });

  it('enregistre une remise limitée aux 2 premiers mois d’un abonnement annuel', async () => {
    const created = await promos.create({
      code: 'DUREE2M',
      discountType: 'percent',
      discountValue: 20,
      appliesTo: 'annual',
      durationMonths: 2,
    });
    expect(created.appliesTo).toBe('annual');
    expect(created.durationMonths).toBe(2);

    // Relu depuis la base : c'est cette valeur qui pilotera la facturation.
    const reread = await promos.findByCode('DUREE2M');
    expect(reread?.durationMonths).toBe(2);
  });

  it('sans durée, la remise couvre toute la période (null)', async () => {
    const created = await promos.create({
      code: 'DUREENULL',
      discountType: 'percent',
      discountValue: 10,
    });
    expect(created.durationMonths).toBeNull();
    expect(created.appliesTo).toBe('both'); // portée par défaut
  });

  it('modifie la durée sans toucher au reste, et sait la remettre à « toute la période »', async () => {
    const existing = await promos.findByCode('DUREE2M');
    const patched = await promos.update(existing!.id, { durationMonths: 1 });
    expect(patched.durationMonths).toBe(1);
    expect(patched.discountValue).toBe(20); // inchangé
    expect(patched.appliesTo).toBe('annual'); // inchangé

    const cleared = await promos.update(existing!.id, { durationMonths: null });
    expect(cleared.durationMonths).toBeNull();
  });

  it('refuse une durée aberrante plutôt que de l’enregistrer', async () => {
    const existing = await promos.findByCode('DUREE2M');
    await expect(promos.update(existing!.id, { durationMonths: 0 })).rejects.toThrow(/1 à 12/);
    await expect(promos.update(existing!.id, { durationMonths: 13 })).rejects.toThrow(/1 à 12/);
  });

  it('refuse une portée inconnue', async () => {
    const existing = await promos.findByCode('DUREE2M');
    await expect(
      promos.update(existing!.id, { appliesTo: 'trimestriel' as never }),
    ).rejects.toThrow(/monthly/);
  });
});
