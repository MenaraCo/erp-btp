import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * La fiche affaire porte les jalons de l'étude PUIS de la réalisation, et confronte le prévu au
 * réel. Le coût réel vient du chantier — jamais d'une saisie, qui divergerait aussitôt du terrain.
 */
describe('Études de prix — jalons et comparatif de la fiche affaire', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post' | 'put' | 'patch', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get' ? request(server).get(path)
        : method === 'put' ? request(server).put(path)
          : method === 'patch' ? request(server).patch(path)
            : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'AffPlan', 'admin', [
      'estimating', 'site_tracking', 'invoicing',
    ]));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('enregistre les jalons d’étude et de réalisation, et les relit', async () => {
    const created = (await as('post', '/affaires').send({ code: 'PLN-1', name: 'PLN-1' }).expect(201)).body;
    await as('patch', `/affaires/${created.affaire.id}`)
      .send({
        responsable: 'MENARA Administrateur',
        dateLimiteRemise: '2026-07-01',
        dateRetourEffectif: '2026-06-28',
        dateDebutEtudes: '2026-06-22',
        dateFinEtudes: '2026-06-30',
        conducteur: 'Chef de chantier',
        dateDebutTravaux: '2026-08-15',
        dateFinTravaux: '2026-11-15',
      })
      .expect(200);

    const a = (await as('get', `/affaires/${created.affaire.id}`).expect(200)).body.affaire;
    expect(a.date_limite_remise).toBe('2026-07-01');
    expect(a.date_retour_effectif).toBe('2026-06-28');
    expect(a.date_debut_etudes).toBe('2026-06-22');
    expect(a.date_fin_etudes).toBe('2026-06-30');
    expect(a.conducteur).toBe('Chef de chantier');
    expect(a.date_debut_travaux).toBe('2026-08-15');
    expect(a.date_fin_travaux).toBe('2026-11-15');
  });

  it('efface une date quand le champ est vidé', async () => {
    const created = (await as('post', '/affaires').send({ code: 'PLN-2', name: 'PLN-2' }).expect(201)).body;
    await as('patch', `/affaires/${created.affaire.id}`).send({ dateLimiteRemise: '2026-07-01' }).expect(200);
    // Un champ date vidé dans le formulaire arrive en chaîne vide : c'est « pas de date ».
    await as('patch', `/affaires/${created.affaire.id}`).send({ dateLimiteRemise: '' }).expect(200);
    const a = (await as('get', `/affaires/${created.affaire.id}`).expect(200)).body.affaire;
    expect(a.date_limite_remise).toBeNull();
  });

  it('n’annonce ni chantier ni coût réel tant que la commande n’est pas acceptée', async () => {
    const created = (await as('post', '/affaires').send({ code: 'PLN-3', name: 'PLN-3' }).expect(201)).body;
    const detail = (await as('get', `/affaires/${created.affaire.id}`).expect(200)).body;
    expect(detail.chantier).toBeNull();
    // Surtout pas 0 € : un coût réel à zéro se lirait « chantier gratuit ».
    expect(detail.reel).toBeNull();
  });

  it('expose le chantier et son coût réel une fois la commande acceptée', async () => {
    const lib = (await as('post', '/libraries').send({ code: 'LPL', name: 'LPL' }).expect(201)).body;
    const r = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'RPL', label: 'R', unit: 'u', nature: 'material', unitCost: '100' })
        .expect(201)
    ).body;
    const o = (
      await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'OPL', label: 'O', unit: 'u' }).expect(201)
    ).body;
    await as('post', `/ouvrages/${o.id}/components`)
      .send({ kind: 'resource', childResourceId: r.id, quantity: '1' })
      .expect(201);

    const created = (await as('post', '/affaires').send({ code: 'PLN-4', name: 'PLN-4' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: o.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({
        byNature: {
          labor: { tauxFg: '0', tauxBenefice: '0' },
          material: { tauxFg: '0', tauxBenefice: '20' },
          equipment: { tauxFg: '0', tauxBenefice: '0' },
          subcontract: { tauxFg: '0', tauxBenefice: '0' },
        },
        tvaRate: '0.20',
      })
      .expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;

    // Une facture fournisseur sur le chantier = du réalisé.
    const ddp = (
      await as('post', `/chantiers/${acc.chantier.id}/purchase-requests`).send({ code: 'DDP-PL' }).expect(201)
    ).body;
    const bc = (await as('post', `/purchase-requests/${ddp.id}/convert`).send({ code: 'BC-PL' }).expect(201)).body;
    await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({ nature: 'material', designation: 'X', quantity: '1', unitPrice: '400' })
      .expect(201);
    await as('post', `/purchase-orders/${bc.id}/validate`).expect(201);
    await as('post', `/purchase-orders/${bc.id}/invoices`)
      .send({ code: 'F-PL', nature: 'material', amountHt: '400' })
      .expect(201);

    const detail = (await as('get', `/affaires/${created.affaire.id}`).expect(200)).body;
    expect(detail.chantier.id).toBe(acc.chantier.id);
    expect(Number(detail.reel.coutReel)).toBe(400);
    // Marge réelle = ce qu'on vend (1 200) moins ce qu'on a dépensé (400).
    expect(Number(detail.totals.pvHt)).toBe(1200);
    expect(Number(detail.reel.margeReelle)).toBe(800);
  });
});
