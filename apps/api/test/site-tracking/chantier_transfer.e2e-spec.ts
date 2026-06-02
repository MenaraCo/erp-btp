import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Site-tracking 3.1 — transfert affaire gagnée → chantier', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

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

  async function buildWonAffaire(code: string) {
    const lib = (await as('post', '/libraries').send({ code: `L-${code}`, name: 'L' }).expect(201)).body;
    const mo = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '40' })
        .expect(201)
    ).body;
    const mat = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'MAT', label: 'Béton', unit: 'm3', nature: 'material', unitCost: '100' })
        .expect(201)
    ).body;
    // OUV: 2h MO (80) + 1 m3 béton (100) -> déboursé 180 (labor 80, material 100)
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);

    const created = (await as('post', '/affaires').send({ code, name: code }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({ byNature: { labor: '1.5', material: '1.2', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' })
      .expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/affaires/${created.affaire.id}/transition`).send({ to }).expect(201);
    }
    return created.affaire.id as string;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Ch', 'admin', ['estimating', 'site_tracking']));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('crée un chantier avec étude d’exécution et budget par nature', async () => {
    const affaireId = await buildWonAffaire('CH-1');
    const res = await as('post', `/affaires/${affaireId}/transfer-to-chantier`).expect(201);
    expect(res.body.lineCount).toBe(1);

    const detail = (await as('get', `/chantiers/${res.body.chantier.id}`).expect(200)).body;
    // budget vente = (80*1.5 + 100*1.2) * 10 = (120+120)*10 = 2400
    expect(detail.chantier.budget_vente_ht).toBe('2400.00');
    // déboursé unitaire objectif = 180, quantité 10
    expect(detail.lines[0].debourse_unitaire_etude).toBe('180.0000');
    expect(detail.lines[0].quantite_etude).toBe('10.0000');

    const byNature = Object.fromEntries(
      detail.budgetByNature.map((b: { nature: string; etude: string }) => [b.nature, b.etude]),
    );
    expect(byNature.labor).toBe('800.00'); // 80 * 10
    expect(byNature.material).toBe('1000.00'); // 100 * 10
    // budget objectif initialisé = budget étude
    const obj = Object.fromEntries(
      detail.budgetByNature.map((b: { nature: string; objectif: string }) => [b.nature, b.objectif]),
    );
    expect(obj.labor).toBe('800.00');
  });

  it('refuse (409) le transfert d’une affaire non gagnée', async () => {
    const lib = (await as('post', '/libraries').send({ code: 'L-X', name: 'L' }).expect(201)).body;
    const created = (await as('post', '/affaires').send({ code: 'CH-2', name: 'x' }).expect(201)).body;
    void lib;
    await as('post', `/affaires/${created.affaire.id}/transfer-to-chantier`).expect(409);
  });

  it('refuse (409) un double transfert', async () => {
    const affaireId = await buildWonAffaire('CH-3');
    await as('post', `/affaires/${affaireId}/transfer-to-chantier`).expect(201);
    await as('post', `/affaires/${affaireId}/transfer-to-chantier`).expect(409);
  });
});
