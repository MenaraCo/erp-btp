import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

const rate = (fg: string, ben: string) => ({ tauxFg: fg, tauxBenefice: ben });

describe('Estimating 1.4 — feuille de vente (FG/Bénéfice par nature, ventilation, frais, remise)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let libraryId: string;
  let ouvrageId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get'
        ? request(server).get(path)
        : method === 'put'
          ? request(server).put(path)
          : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Vente', 'admin', 'estimating'));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'Lib' }).expect(201)).body;
    libraryId = lib.id;
    const mo = (
      await as('post', `/libraries/${libraryId}/resources`)
        .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '100' })
        .expect(201)
    ).body;
    const mat = (
      await as('post', `/libraries/${libraryId}/resources`)
        .send({ code: 'MAT', label: 'Matériau', unit: 'u', nature: 'material', unitCost: '200' })
        .expect(201)
    ).body;
    // OUV1 = 100 labor + 200 material -> déboursé 300
    const ouv = (
      await as('post', `/libraries/${libraryId}/ouvrages`)
        .send({ code: 'OUV1', label: 'Ouvrage 1', unit: 'u' })
        .expect(201)
    ).body;
    ouvrageId = ouv.id;
    await as('post', `/ouvrages/${ouvrageId}/components`)
      .send({ kind: 'resource', childResourceId: mo.id, quantity: '1' })
      .expect(201);
    await as('post', `/ouvrages/${ouvrageId}/components`)
      .send({ kind: 'resource', childResourceId: mat.id, quantity: '1' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('cascade FG puis Bénéfice par nature (rule #2) : revient, PV, marges et TVA', async () => {
    const version = (
      await as('post', '/affaires').send({ code: 'AV1', name: 'A' }).expect(201)
    ).body.version;
    await as('post', `/versions/${version.id}/lines`)
      .send({ type: 'ouvrage', designation: 'Ligne 1', sourceOuvrageId: ouvrageId, quantity: '1' })
      .expect(201);
    await as('put', `/versions/${version.id}/sale-sheet`)
      .send({
        byNature: {
          labor: rate('20', '25'), // 100 -> revient 120 -> pv 150
          material: rate('20', '0'), // 200 -> revient 240 -> pv 240
          equipment: rate('0', '0'),
          subcontract: rate('0', '0'),
        },
        tvaRate: '0.20',
      })
      .expect(200);

    const fv = (await as('get', `/versions/${version.id}/sale-sheet`).expect(200)).body;
    expect(fv.items[0].revient).toBe('360'); // 120 + 240
    expect(fv.items[0].pv).toBe('390'); // 150 + 240
    expect(fv.items[0].margeBrute).toBe('90'); // 390 - 300
    expect(fv.items[0].margeNette).toBe('30'); // 390 - 360
    expect(fv.items[0].appliedRates.labor).toEqual({ fg: '20', benefice: '25' });
    expect(fv.totalPvHt).toBe('390');
    expect(fv.tva).toBe('78');
    expect(fv.totalTtc).toBe('468');
  });

  it('ventile les frais de chantier (rule #3) prorata déboursé', async () => {
    const version = (
      await as('post', '/affaires').send({ code: 'AV2', name: 'B' }).expect(201)
    ).body.version;
    await as('post', `/versions/${version.id}/lines`)
      .send({ type: 'ouvrage', designation: 'V1', sourceOuvrageId: ouvrageId, quantity: '1' })
      .expect(201);
    await as('post', `/versions/${version.id}/lines`)
      .send({ type: 'ouvrage', designation: 'V2', sourceOuvrageId: ouvrageId, quantity: '1' })
      .expect(201);
    await as('post', `/versions/${version.id}/lines`)
      .send({
        type: 'ouvrage',
        designation: 'Frais chantier',
        sourceOuvrageId: ouvrageId,
        quantity: '1',
        vendable: false,
      })
      .expect(201);
    // coefficients all 0 -> PV = déboursé + ventilated frais. Frais 300 split 150/150.
    await as('put', `/versions/${version.id}/sale-sheet`)
      .send({
        byNature: {
          labor: rate('0', '0'),
          material: rate('0', '0'),
          equipment: rate('0', '0'),
          subcontract: rate('0', '0'),
        },
        tvaRate: '0',
      })
      .expect(200);

    const fv = (await as('get', `/versions/${version.id}/sale-sheet`).expect(200)).body;
    expect(fv.items).toHaveLength(2); // only vendable items are priced
    for (const item of fv.items) {
      expect(item.ventilatedFrais).toBe('150'); // 300 * 300/600
      expect(item.pv).toBe('450'); // 300 + 150
    }
    expect(fv.totalPvHt).toBe('900'); // total conserved: 300+300+300
  });

  it('frais annexes (% + fixe), remise et PV forcé par ligne', async () => {
    const version = (
      await as('post', '/affaires').send({ code: 'AV3', name: 'C' }).expect(201)
    ).body.version;
    const line = (
      await as('post', `/versions/${version.id}/lines`)
        .send({ type: 'ouvrage', designation: 'L', sourceOuvrageId: ouvrageId, quantity: '1' })
        .expect(201)
    ).body;
    await as('put', `/versions/${version.id}/sale-sheet`)
      .send({
        byNature: {
          labor: rate('0', '0'),
          material: rate('0', '0'),
          equipment: rate('0', '0'),
          subcontract: rate('0', '0'),
        },
        remise: { type: 'fixe', valeur: '30' },
        tvaRate: '0',
      })
      .expect(200);
    await as('put', `/versions/${version.id}/frais-annexes`)
      .send({ frais: [{ designation: 'Compte prorata', type: 'pct', valeur: '10' }] })
      .expect(200);

    // PV ligne = déboursé 300 ; frais annexes 10% = 30 ; pvDevis 330 ; remise 30 ; net 300
    let fv = (await as('get', `/versions/${version.id}/sale-sheet`).expect(200)).body;
    expect(fv.pvHorsFrais).toBe('300');
    expect(fv.fraisAnnexes).toBe('30');
    expect(fv.pvDevis).toBe('330');
    expect(fv.remise).toBe('30');
    expect(fv.totalPvHt).toBe('300');

    // Force the line PV to 500/u
    await as('put', `/versions/${version.id}/lines/${line.id}/pv`)
      .send({ puVente: '500', force: true })
      .expect(200);
    fv = (await as('get', `/versions/${version.id}/sale-sheet`).expect(200)).body;
    expect(fv.items[0].forced).toBe(true);
    expect(fv.items[0].pv).toBe('500');
    expect(fv.items[0].pvComputed).toBe('300'); // calculé conservé en référence
    expect(fv.pvHorsFrais).toBe('500');
    expect(fv.fraisAnnexes).toBe('50'); // 10% de 500
    expect(fv.totalPvHt).toBe('520'); // 550 - 30
  });
});
