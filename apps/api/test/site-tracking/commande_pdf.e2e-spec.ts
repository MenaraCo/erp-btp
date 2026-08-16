import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Édition PDF du bon de commande.
 *
 * Le PDF est la seule sortie officielle d'une commande : il doit porter ce qui engage (numéro,
 * livraison, lignes, total) et RIEN qui ne regarde que nous — le code analytique sert notre
 * comptabilité, l'afficher au fournisseur lui donnerait à lire notre organisation interne.
 */
describe('Site-tracking — bon de commande PDF', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let codeAnalytiqueId: string;

  function as(method: 'get' | 'post', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'BcPdf', 'admin', ['site_tracking', 'core']));
    chantierId = (await as('post', '/chantiers').send({ name: 'Tour Nord' }).expect(201)).body.id;

    const lotId = (await as('post', '/params/lots').send({ code: 'GO', label: 'Gros œuvre' }).expect(201)).body.id;
    const familleId = (await as('post', '/params/familles')
      .send({ lotId, code: 'MAC', label: 'Maçonnerie' }).expect(201)).body.id;
    codeAnalytiqueId = (await as('post', '/params/codes')
      .send({ familleId, code: '280', label: 'Colle' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('produit_un_pdf_lisible_avec_ses_lignes_et_son_total', async () => {
    const bc = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({}).expect(201)).body;
    await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({
        nature: 'material', designation: 'Sacs de colle', quantity: '10', unitPrice: '50',
        codeAnalytiqueId, code: 'COLLE', uniteAchat: 'sac',
      })
      .expect(201);
    await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({ kind: 'comment', designation: 'Livrer par la rue arrière' })
      .expect(201);

    const res = await as('get', `/purchase-orders/${bc.id}/bon-de-commande.pdf`).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    // Un PDF commence par %PDF- ; un corps vide ou une page blanche se verrait ici.
    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1500);

    // Une commande de deux lignes tient sur UNE page. Compter les pages n'est pas un détail :
    // un pied de page écrit sous la marge fait ajouter une page vide à chaque passage, et le
    // document s'ouvre alors sur du vide — ce que la seule signature %PDF- ne révèle pas.
    const pages = (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBe(1);
  });

  it("l_apercu_est_disponible_AVANT_l_envoi_pour_relire_ce_qui_partira", async () => {
    const bc = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({}).expect(201)).body;
    await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({ nature: 'material', designation: 'Sable', quantity: '2', unitPrice: '80', codeAnalytiqueId })
      .expect(201);

    // Brouillon : le PDF s'édite quand même, c'est tout l'intérêt d'un aperçu.
    const brouillon = await as('get', `/purchase-orders/${bc.id}/bon-de-commande.pdf`).expect(200);
    expect((brouillon.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    await as('post', `/purchase-orders/${bc.id}/submit`).expect(201);
    const envoye = await as('get', `/purchase-orders/${bc.id}/bon-de-commande.pdf`).expect(200);
    expect((envoye.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('refuse_une_commande_inconnue', async () => {
    await as('get', '/purchase-orders/00000000-0000-0000-0000-000000000000/bon-de-commande.pdf')
      .expect(404);
  });
});
