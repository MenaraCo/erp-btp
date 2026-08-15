import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { PromoModule } from '../../src/core/promo/promo.module';
import { PricingModule } from '../../src/core/pricing/pricing.module';
import { EditorModule } from '../../src/core/editor/editor.module';
import { EditorService } from '../../src/core/editor/editor.service';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';
import { createTestDataSource, createTenant } from '../support/datasource';
import { activateModule } from '../support/entitlements.helpers';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
    TenancyModule,
    CatalogModule,
    PromoModule,
    PricingModule,
    EditorModule,
  ],
})
class EditeurJetonsModule {}

/**
 * La console éditeur doit compter les jetons COMME LE CLIENT les voit : la réserve du palier
 * (sièges × jetons par siège) plus les jetons des options. Additionner `seats_purchased` module
 * par module donnait le bon total tant qu'un siège ouvrait exactement un jeton par module ; dès
 * que l'éditeur règle ce nombre, les deux divergent et il facturerait sur un chiffre que le
 * client ne reconnaît pas.
 */
describe('Éditeur — les jetons affichés correspondent à la réserve du client', () => {
  let app: INestApplication;
  let ds: DataSource;
  let editor: EditorService;

  const abonner = (tenantId: string, packCode: string, seats: number) =>
    runInTenant(ds, tenantId, (em) =>
      em.query(
        `INSERT INTO subscription (tenant_id, status, pack_code, pack_seats)
         VALUES ($1, 'active', $2, $3)`,
        [tenantId, packCode, seats],
      ),
    );

  const ligne = async (tenantId: string) =>
    (await editor.getTenants()).find((t) => t.tenantId === tenantId)!;

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({ imports: [EditeurJetonsModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    editor = app.get(EditorService);
  });

  afterAll(async () => {
    await ds.query(`UPDATE pack SET seat_tokens = NULL WHERE code = 'pro'`);
    await app.close();
    await ds.destroy();
  });

  it('compte la réserve du palier, et non la somme module par module', async () => {
    const t = await createTenant(ds, 'EditeurJetons');
    await abonner(t.id, 'pro', 4); // 3 modules → 12 jetons
    for (const m of ['core', 'estimating', 'invoicing']) await activateModule(ds, t.id, m, 4);

    expect((await ligne(t.id)).seatsPurchased).toBe(12);
  });

  it('suit le réglage éditeur des jetons par siège', async () => {
    const t = await createTenant(ds, 'EditeurJetonsReglage');
    await abonner(t.id, 'pro', 4);
    for (const m of ['core', 'estimating', 'invoicing']) await activateModule(ds, t.id, m, 4);

    await ds.query(`UPDATE pack SET seat_tokens = 10 WHERE code = 'pro'`);
    // 4 sièges × 10 jetons = 40, alors que la somme par module vaudrait toujours 12.
    expect((await ligne(t.id)).seatsPurchased).toBe(40);
  });
});
