import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

describe('Invoicing 2.1 — acceptation : transfert affaire gagnée → marché', () => {
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

  async function buildCostedAffaire(code: string) {
    const lib = (await as('post', '/libraries').send({ code: `L-${code}`, name: 'L' }).expect(201)).body;
    const mat = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'MAT', label: 'Mat', unit: 'u', nature: 'material', unitCost: '200' })
        .expect(201)
    ).body;
    const ouv = (
      await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)
    ).body;
    await as('post', `/ouvrages/${ouv.id}/components`)
      .send({ kind: 'resource', childResourceId: mat.id, quantity: '1' })
      .expect(201);

    const created = (await as('post', '/affaires').send({ code, name: code }).expect(201)).body;
    const affaireId = created.affaire.id;
    const versionId = created.version.id;
    await as('post', `/versions/${versionId}/lines`)
      .send({ type: 'ouvrage', designation: 'Ligne', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${versionId}/sale-sheet`)
      .send({
        byNature: { labor: '1', material: '1.2', equipment: '1', subcontract: '1' },
        fraisCoefficient: '1',
        tvaRate: '0.20',
      })
      .expect(200);
    return affaireId;
  }

  async function winAffaire(affaireId: string) {
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/affaires/${affaireId}/transition`).send({ to }).expect(201);
    }
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Accept', 'admin', ['estimating', 'invoicing']));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('transfère une affaire gagnée en marché avec lignes valorisées', async () => {
    const affaireId = await buildCostedAffaire('ACC-1');
    await winAffaire(affaireId);

    const res = await as('post', `/affaires/${affaireId}/accept`).expect(201);
    expect(res.body.lineCount).toBe(1);
    // PV = déboursé 200 * 1.2 = 240 ; quantité 10 -> montant 2400, PU 240
    expect(res.body.marche.total_ht).toBe('2400.00');

    const marche = (await as('get', `/marches/${res.body.marche.id}`).expect(200)).body;
    expect(marche.lines[0].pu).toBe('240.0000');
    expect(marche.lines[0].quantite).toBe('10.0000');
    expect(marche.lines[0].montant_ht).toBe('2400.00');
  });

  it('refuse (409) le transfert d’une affaire non gagnée', async () => {
    const affaireId = await buildCostedAffaire('ACC-2'); // stays 'open'
    await as('post', `/affaires/${affaireId}/accept`).expect(409);
  });

  it('refuse (409) un double transfert de la même version', async () => {
    const affaireId = await buildCostedAffaire('ACC-3');
    await winAffaire(affaireId);
    await as('post', `/affaires/${affaireId}/accept`).expect(201);
    await as('post', `/affaires/${affaireId}/accept`).expect(409);
  });
});
