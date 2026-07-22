import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { INestApplication } from '@nestjs/common';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { CatalogService } from '../../src/core/catalog/catalog.service';

/** The read API the capability guard (phase 0.4) will rely on. */
describe('CatalogService — résolution des capacités', () => {
  let app: INestApplication;
  let service: CatalogService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot(buildTypeOrmOptions('app')), CatalogModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(CatalogService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('agrège les capacités de plusieurs modules', async () => {
    const keys = await service.getCapabilityKeysForModuleCodes([
      'estimating',
      'invoicing',
    ]);
    expect([...keys].sort()).toEqual([
      'estimating.advanced',
      'estimating.bid',
      'invoicing.dgd',
      'invoicing.situations',
    ]);
  });

  it('retourne un ensemble vide pour une liste de modules vide', async () => {
    const keys = await service.getCapabilityKeysForModuleCodes([]);
    expect(keys.size).toBe(0);
  });

  it('résout les modules d’un pack', async () => {
    // L'offre est vendue en paliers : Pro Chantier = Socle + Études + Facturation + Suivi.
    const codes = await service.getModuleCodesForPack('pro_chantier');
    expect(codes).toEqual(['core', 'estimating', 'invoicing', 'site_tracking']);
  });
});
