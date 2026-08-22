import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

/**
 * Les pièces que le CLIENT reçoit : situation de travaux, facture, décompte général définitif.
 *
 * Elles n'avaient pas d'édition — seule existait un PDF Factur-X de huit lignes, sans en-tête de
 * société ni détail. Un client qui reçoit une facture nue doit vérifier d'où elle vient ; celui
 * qui reçoit une situation sans le chemin jusqu'au net à payer ne peut pas la contrôler.
 */
describe('Facturation — édition des situations, factures et DGD', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let marcheId: string;
  let situationId: string;

  function as(method: 'get' | 'post' | 'patch' | 'put', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'patch' ? request(s).patch(path)
        : method === 'put' ? request(s).put(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  const telecharger = async (chemin: string): Promise<Buffer> => {
    const r = await as('get', chemin)
      .buffer(true)
      .parse((response, cb) => {
        const data: Buffer[] = [];
        response.on('data', (c: Buffer) => data.push(Buffer.from(c)));
        response.on('end', () => cb(null, Buffer.concat(data)));
      })
      .expect(200);
    return r.body as Buffer;
  };

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'DocPdf', 'admin', [
      'core', 'estimating', 'invoicing', 'site_tracking',
    ]));
    await runInTenant(ds, tenantId, (em) =>
      em.query(`INSERT INTO company (tenant_id, code, name, address, postal_code, city, siret)
                VALUES ($1, 'STE', 'Entreprise de test', '3 rue des Chantiers', '75011', 'Paris', '12345678900012')`,
      [tenantId]));

    // Un devis gagné, accepté : marché + chantier, puis une situation à 40 %.
    const lib = (await as('post', '/libraries').send({ code: 'LD', name: 'LD' }).expect(201)).body;
    const res = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'RD', label: 'Béton', unit: 'm3', nature: 'material', unitCost: '100' })
      .expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`)
      .send({ code: 'OD', label: 'Dalle béton', unit: 'm2' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`)
      .send({ kind: 'resource', childResourceId: res.id, quantity: '1' }).expect(201);

    const affaire = (await as('post', '/affaires').send({ code: 'DOC-1', name: 'Villa Doc' }).expect(201)).body;
    await as('post', `/versions/${affaire.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Dalle béton', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${affaire.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${affaire.devis.id}/accept`).expect(201)).body;
    marcheId = acc.marche.id;

    const lignes = (await as('get', `/marches/${marcheId}`).expect(200)).body.lines ?? [];
    situationId = (await as('post', `/marches/${marcheId}/situations`)
      .send({
        lines: lignes
          .filter((l: { id: string; type?: string }) => l.type !== 'titre')
          .map((l: { id: string }) => ({ marcheLineId: l.id, pctAvancement: '0.4' })),
      })
      .expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('edite_une_situation_de_travaux_avec_son_chemin_jusqu_au_net_a_payer', async () => {
    const pdf = await telecharger(`/situations/${situationId}/situation.pdf`);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    // Un vrai document, pas un reçu : en-tête, corps et pied pèsent leur poids.
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it('edite_la_facture_issue_de_la_situation', async () => {
    // Une société de facturation, et son chrono : un numéro de facture ne s'improvise pas.
    const societes = (await as('get', '/companies').expect(200)).body;
    const companyId = (Array.isArray(societes) ? societes[0] : societes.rows?.[0])?.id;
    await as('put', `/companies/${companyId}/chrono`).send({ pattern: 'FAC-{SEQ:5}' }).expect(200);
    const facture = (await as('post', `/situations/${situationId}/invoice`)
      .send({ companyId }).expect(201)).body;
    const pdf = await telecharger(`/invoices/${facture.id}/facture.pdf`);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it('edite_le_decompte_general_definitif', async () => {
    const dgd = (await as('post', `/marches/${marcheId}/dgd`).send({}).expect(201)).body;
    const pdf = await telecharger(`/dgd/${dgd.id}/dgd.pdf`);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it('refuse_d_editer_une_piece_inexistante', async () => {
    await as('get', '/situations/00000000-0000-0000-0000-000000000000/situation.pdf').expect(404);
    await as('get', '/invoices/00000000-0000-0000-0000-000000000000/facture.pdf').expect(404);
    await as('get', '/dgd/00000000-0000-0000-0000-000000000000/dgd.pdf').expect(404);
  });
});
