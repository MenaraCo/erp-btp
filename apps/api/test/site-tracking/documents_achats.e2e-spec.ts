import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Import des bons de livraison et factures, avec lecture automatique.
 *
 * Deux exigences opposées se tiennent ici : lire ce qui est lisible pour épargner la saisie, et
 * ne JAMAIS inventer une quantité. Un document illisible (scan) doit être conservé et annoncé
 * comme non lu ; une ligne non reconnue doit rester vide.
 */
describe('Site-tracking — documents d’achat', () => {
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

  async function commandeEnvoyee(): Promise<{ id: string; ligne: string }> {
    const bc = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({}).expect(201)).body;
    const ligne = (await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({
        nature: 'material', designation: 'Sacs de colle', quantity: '10', unitPrice: '50',
        code: 'COLLE', codeAnalytiqueId,
      })
      .expect(201)).body;
    await as('post', `/purchase-orders/${bc.id}/submit`).expect(201);
    return { id: bc.id, ligne: ligne.id };
  }

  /** Le PDF du bon de commande sert de document de test : il porte le code et les quantités. */
  async function pdfDeLaCommande(orderId: string): Promise<Buffer> {
    const res = await as('get', `/purchase-orders/${orderId}/bon-de-commande.pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const morceaux: Buffer[] = [];
        r.on('data', (m: Buffer) => morceaux.push(m));
        r.on('end', () => cb(null, Buffer.concat(morceaux)));
      })
      .expect(200);
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    return pdf;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Docs', 'admin', ['site_tracking', 'core']));
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

  it('lit_un_pdf_et_propose_les_quantites_reconnues', async () => {
    const { id, ligne } = await commandeEnvoyee();
    const pdf = await pdfDeLaCommande(id);

    const r = (await as('post', `/purchase-orders/${id}/documents?type=delivery`)
      .attach('file', pdf, { filename: 'BL-fournisseur.pdf', contentType: 'application/pdf' })
      .expect(201)).body;

    expect(r.document.lecture).toBe('lu');
    expect(r.document.nomFichier).toBe('BL-fournisseur.pdf');

    const proposition = r.propositions.find((p: { orderLineId: string }) => p.orderLineId === ligne);
    expect(proposition.code).toBe('COLLE');
    expect(Number(proposition.resteAttendu)).toBe(10);
    // Le document porte « COLLE … 10,00 … » : la quantité doit être reconnue et l'indice montré.
    expect(Number(proposition.quantiteLue)).toBe(10);
    expect(proposition.indice).toContain('COLLE');
  });

  it('conserve_un_document_illisible_sans_pretendre_lavoir_lu', async () => {
    const { id, ligne } = await commandeEnvoyee();
    const image = Buffer.from('89504e470d0a1a0a', 'hex'); // en-tête PNG : aucun texte

    const r = (await as('post', `/purchase-orders/${id}/documents?type=delivery`)
      .attach('file', image, { filename: 'photo-bl.png', contentType: 'image/png' })
      .expect(201)).body;

    expect(r.document.lecture).toBe('sans_texte');
    expect(r.message).toMatch(/saisissez/i);
    // Aucune quantité inventée : toutes les propositions sont vides.
    const proposition = r.propositions.find((p: { orderLineId: string }) => p.orderLineId === ligne);
    expect(proposition.quantiteLue).toBeNull();

    // Mais le fichier est bien conservé et se retélécharge.
    const liste = (await as('get', `/purchase-orders/${id}/documents`).expect(200)).body;
    expect(liste).toHaveLength(1);
    const contenu = await as('get', `/purchase-documents/${liste[0].id}/contenu`).expect(200);
    expect((contenu.body as Buffer).length).toBe(image.length);
  });

  it('relit_un_document_apres_correction_de_la_commande', async () => {
    const { id } = await commandeEnvoyee();
    const pdf = await pdfDeLaCommande(id);
    const importe = (await as('post', `/purchase-orders/${id}/documents?type=invoice`)
      .attach('file', pdf, { filename: 'FF-123.pdf', contentType: 'application/pdf' })
      .expect(201)).body;

    const relu = (await as('post', `/purchase-documents/${importe.document.id}/relire`).expect(201)).body;
    expect(relu.propositions).toHaveLength(1);
    expect(Number(relu.propositions[0].quantiteLue)).toBe(10);
    // Sur une facture, on lit aussi le prix unitaire pour le comparer à la commande.
    expect(Number(relu.propositions[0].puLu)).toBeGreaterThan(0);
  });

  it('refuse_un_fichier_absent', async () => {
    const { id } = await commandeEnvoyee();
    await as('post', `/purchase-orders/${id}/documents`).expect(400);
  });
});
