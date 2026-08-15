import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.config';
import { TenancyModule } from '../../src/core/tenancy/tenancy.module';
import { CatalogModule } from '../../src/core/catalog/catalog.module';
import { EntitlementsModule } from '../../src/core/entitlements/entitlements.module';
import { EntitlementsService } from '../../src/core/entitlements/entitlements.service';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';
import { createTestDataSource, createTenant } from '../support/datasource';
import { createUser, activateModule } from '../support/entitlements.helpers';

/**
 * Jetons : un POOL PARTAGÉ par la société, pas un compteur par module.
 *
 * Le palier donne autant de jetons par siège qu'il contient de modules (Socle compris) : « Pro »
 * (Socle + Études de prix + Facturation) vaut 3 jetons par siège, « Pro Max » en vaut 5. Chaque
 * couple utilisateur × module en consomme UN, quel que soit le module — un jeton posé sur Études
 * de prix diminue d'autant ce qui reste pour le Suivi de chantiers.
 *
 * La valeur vendue est inchangée (N sièges × M modules = N × M accès), mais le client répartit
 * librement : 3 personnes sur un seul module chacune, ou 1 personne sur les trois.
 */
describe('Jetons — pool partagé entre tous les modules du palier', () => {
  let app: INestApplication;
  let ds: DataSource;
  let service: EntitlementsService;

  const souscrirePalier = (tenantId: string, packCode: string, seats: number) =>
    runInTenant(ds, tenantId, (em) =>
      em.query(
        `INSERT INTO subscription (tenant_id, status, pack_code, pack_seats)
         VALUES ($1, 'active', $2, $3)`,
        [tenantId, packCode, seats],
      ),
    );

  beforeAll(async () => {
    ds = await createTestDataSource();
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(buildTypeOrmOptions('app')),
        TenancyModule,
        CatalogModule,
        EntitlementsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(EntitlementsService);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('le palier Pro (3 modules) donne 3 jetons par siège', async () => {
    const t = await createTenant(ds, 'PoolPro');
    await souscrirePalier(t.id, 'pro', 1);
    for (const m of ['core', 'estimating', 'invoicing']) await activateModule(ds, t.id, m, 1);

    const pool = await service.getSeatPool(t.id);
    expect(pool.total).toBe(3); // 1 siège × 3 modules
    expect(pool.used).toBe(0);
    expect(pool.remaining).toBe(3);
  });

  it('le palier Pro Max (5 modules) donne 5 jetons par siège', async () => {
    const t = await createTenant(ds, 'PoolProMax');
    await souscrirePalier(t.id, 'pro_max', 1);
    const pool = await service.getSeatPool(t.id);
    expect(pool.total).toBe(5);
  });

  it('un jeton posé sur un module diminue ce qui reste pour les AUTRES modules', async () => {
    const t = await createTenant(ds, 'PoolPartage');
    await souscrirePalier(t.id, 'pro_chantier', 1); // 4 modules → 4 jetons
    for (const m of ['core', 'estimating', 'invoicing', 'site_tracking']) {
      await activateModule(ds, t.id, m, 1);
    }
    const paul = await createUser(ds, t.id, 'paul@pool.test');
    const marie = await createUser(ds, t.id, 'marie@pool.test');

    expect((await service.getSeatPool(t.id)).remaining).toBe(4);

    // Paul sur Études de prix : il en reste 3 AU TOTAL, tous modules confondus.
    await service.assignSeat(t.id, 'estimating', paul);
    expect((await service.getSeatPool(t.id)).remaining).toBe(3);

    // Marie sur Suivi de chantiers : encore un de moins, alors que c'est un autre module.
    await service.assignSeat(t.id, 'site_tracking', marie);
    expect((await service.getSeatPool(t.id)).remaining).toBe(2);

    // Reprendre un jeton le rend au pool commun.
    const seats = await service.listSeatAssignments(t.id);
    const celuiDePaul = seats.find((s) => s.userId === paul && s.moduleCode === 'estimating');
    await service.unassignSeat(t.id, celuiDePaul!.id);
    expect((await service.getSeatPool(t.id)).remaining).toBe(3);
  });

  it('refuse une affectation quand le pool est épuisé, même sur un module encore vierge', async () => {
    const t = await createTenant(ds, 'PoolEpuise');
    await souscrirePalier(t.id, 'pro', 1); // 3 modules → 3 jetons
    for (const m of ['core', 'estimating', 'invoicing']) await activateModule(ds, t.id, m, 1);
    const a = await createUser(ds, t.id, 'a@epuise.test');
    const b = await createUser(ds, t.id, 'b@epuise.test');

    await service.assignSeat(t.id, 'core', a);
    await service.assignSeat(t.id, 'estimating', a);
    await service.assignSeat(t.id, 'invoicing', a); // 3/3 : pool épuisé

    expect((await service.getSeatPool(t.id)).remaining).toBe(0);
    // Facturation n'a pourtant qu'un seul jeton posé : c'est bien le POOL qui bloque.
    await expect(service.assignSeat(t.id, 'invoicing', b)).rejects.toThrow(/jeton/i);
  });

  it('plusieurs sièges multiplient le pool', async () => {
    const t = await createTenant(ds, 'PoolMultiSieges');
    await souscrirePalier(t.id, 'pro', 5); // 5 sièges × 3 modules
    const pool = await service.getSeatPool(t.id);
    expect(pool.total).toBe(15);
  });

  it('l’éditeur peut régler les jetons par siège d’un palier', async () => {
    // Levier commercial : rendre un palier plus généreux sans toucher au code.
    const t = await createTenant(ds, 'PoolReglable');
    await souscrirePalier(t.id, 'essentiel', 2); // 2 modules → 4 jetons par défaut
    expect((await service.getSeatPool(t.id)).total).toBe(4);
    expect((await service.getSeatPool(t.id)).tokensPerSeat).toBe(2);

    await ds.query(`UPDATE pack SET seat_tokens = 5 WHERE code = 'essentiel'`);
    const regle = await service.getSeatPool(t.id);
    expect(regle.tokensPerSeat).toBe(5);
    expect(regle.total).toBe(10); // 2 sièges × 5

    // Vider le réglage revient au défaut (un jeton par module).
    await ds.query(`UPDATE pack SET seat_tokens = NULL WHERE code = 'essentiel'`);
    expect((await service.getSeatPool(t.id)).total).toBe(4);
  });

  it('une option (add-on) garde ses propres jetons, hors du pool du palier', async () => {
    const t = await createTenant(ds, 'PoolAddon');
    await souscrirePalier(t.id, 'pro_chantier', 1); // pool de 4
    for (const m of ['core', 'estimating', 'invoicing', 'site_tracking']) {
      await activateModule(ds, t.id, m, 1);
    }
    await activateModule(ds, t.id, 'stock_equipment', 1); // option : 1 jeton acheté
    const u1 = await createUser(ds, t.id, 'u1@addon.test');
    const u2 = await createUser(ds, t.id, 'u2@addon.test');

    await service.assignSeat(t.id, 'stock_equipment', u1);
    // L'option ne puise pas dans le pool du palier.
    expect((await service.getSeatPool(t.id)).remaining).toBe(4);
    // Mais elle a sa propre limite : 1 jeton acheté, donc le second est refusé.
    await expect(service.assignSeat(t.id, 'stock_equipment', u2)).rejects.toThrow();
  });
});
