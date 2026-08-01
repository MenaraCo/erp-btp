import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * M.1b — une affaire regroupe plusieurs devis (Lot 1, Lot 2…) ; le workflow vit sur le devis,
 * le statut de l'affaire est dérivé (en_cours / gagnee_partielle / gagnee). L'acceptation est
 * par devis.
 */
describe('Estimating — couche devis (affaire 1→N devis, statut dérivé, accept par devis)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let ouvrageId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get' ? request(server).get(path)
        : method === 'put' ? request(server).put(path)
          : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  async function winDevis(devisId: string) {
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${devisId}/transition`).send({ to }).expect(201);
    }
  }

  async function affaireStatus(affaireId: string): Promise<string> {
    return (await as('get', `/affaires/${affaireId}`).expect(200)).body.affaire.status;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Layer', 'admin', ['estimating', 'invoicing']));
    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const r = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'R', label: 'R', unit: 'u', nature: 'material', unitCost: '100' }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: r.id, quantity: '1' }).expect(201);
    ouvrageId = ouv.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('crée une affaire avec un devis principal + permet d’ajouter d’autres devis', async () => {
    const created = (await as('post', '/affaires').send({ code: 'AFF-L1', name: 'Chantier A' }).expect(201)).body;
    expect(created.devis.type).toBe('principal');
    expect(created.devis.status).toBe('open');
    expect(created.affaire.status).toBe('en_cours');

    const lot2 = (await as('post', `/affaires/${created.affaire.id}/devis`)
      .send({ designation: 'Lot 2 — Sols', type: 'lot' }).expect(201)).body;
    expect(lot2.devis.type).toBe('lot');

    const detail = (await as('get', `/affaires/${created.affaire.id}`).expect(200)).body;
    expect(detail.devis).toHaveLength(2);
    expect(detail.devis[1].designation).toBe('Lot 2 — Sols');
  });

  it('statut affaire dérivé : gagnee_partielle puis gagnee', async () => {
    const created = (await as('post', '/affaires').send({ code: 'AFF-L2', name: 'B' }).expect(201)).body;
    const devis1 = created.devis.id;
    const lot2 = (await as('post', `/affaires/${created.affaire.id}/devis`)
      .send({ designation: 'Lot 2', type: 'lot' }).expect(201)).body.devis;

    expect(await affaireStatus(created.affaire.id)).toBe('en_cours');

    await winDevis(devis1);
    expect(await affaireStatus(created.affaire.id)).toBe('gagnee_partielle');

    await winDevis(lot2.id);
    expect(await affaireStatus(created.affaire.id)).toBe('gagnee');
  });

  it('acceptation par devis : un devis gagné devient un marché', async () => {
    const created = (await as('post', '/affaires').send({ code: 'AFF-L3', name: 'C' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouvrageId, quantity: '5' }).expect(201);

    // non gagné -> 409
    await as('post', `/devis/${created.devis.id}/accept`).expect(409);

    await winDevis(created.devis.id);
    const res = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    expect(res.marche.id).toBeTruthy();
    expect(res.chantier.id).toBeTruthy();
  });
});
