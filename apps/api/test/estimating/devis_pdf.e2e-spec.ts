import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

describe('Estimating 1.6 — édition PDF du devis', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function hdr(r: request.Test) {
    return r.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Pdf', 'admin', 'estimating'));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('génère un PDF de devis (application/pdf, en-tête %PDF)', async () => {
    const version = (
      await hdr(request(app.getHttpServer()).post('/affaires')).send({ code: 'PDF-1', name: 'Maison' })
    ).body.version;
    await hdr(request(app.getHttpServer()).post(`/versions/${version.id}/lines`)).send({
      type: 'titre',
      code: '1',
      designation: 'Gros œuvre',
    });

    const res = await hdr(request(app.getHttpServer()).get(`/versions/${version.id}/devis.pdf`))
      .buffer(true)
      .parse((response, cb) => {
        const data: Buffer[] = [];
        response.on('data', (c: Buffer) => data.push(Buffer.from(c)));
        response.on('end', () => cb(null, Buffer.concat(data)));
      })
      .expect(200);

    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    const body = res.body as Buffer;
    expect(body.length).toBeGreaterThan(100);
    expect(body.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('génère le PDF d’un devis contenant une ligne de frais (règle de visibilité : unitaires)', async () => {
    const post = (path: string) => hdr(request(app.getHttpServer()).post(path));
    const put = (path: string) => hdr(request(app.getHttpServer()).put(path));
    const created = (await post('/affaires').send({ code: 'PDF-FR', name: 'PDF frais' }).expect(201)).body;
    const v = created.version.id;
    const titre = (
      await post(`/versions/${v}/lines`)
        .send({ type: 'titre', code: '1', designation: 'TRAVAUX FACTURES', sortOrder: 1 })
        .expect(201)
    ).body;
    await post(`/versions/${v}/lines`)
      .send({
        type: 'ressource', parentLineId: titre.id, code: 'R1', designation: 'PRESTATION VENDUE',
        unit: 'u', quantity: '1', pu: '1000', nature: 'material',
      })
      .expect(201);
    await post(`/versions/${v}/lines`)
      .send({
        type: 'ressource', parentLineId: titre.id, code: 'F1', designation: 'INSTALLATION CHANTIER',
        unit: 'u', quantity: '1', pu: '200', nature: 'material',
        vendable: false, ventilationBase: 'propre',
      })
      .expect(201);
    await put(`/versions/${v}/sale-sheet`)
      .send({
        byNature: {
          labor: { tauxFg: '0', tauxBenefice: '0' },
          material: { tauxFg: '0', tauxBenefice: '0' },
          equipment: { tauxFg: '0', tauxBenefice: '0' },
          subcontract: { tauxFg: '0', tauxBenefice: '0' },
        },
        tvaRate: '0.20',
      })
      .expect(200);

    // Le contenu textuel d'un PDF PDFKit est compressé : la règle de visibilité elle-même est
    // couverte par devis-client-view.spec.ts. Ici on garantit que le rendu passe toujours.
    const res = await hdr(request(app.getHttpServer()).get(`/versions/${v}/devis.pdf`))
      .buffer(true)
      .parse((response, cb) => {
        const data: Buffer[] = [];
        response.on('data', (c: Buffer) => data.push(Buffer.from(c)));
        response.on('end', () => cb(null, Buffer.concat(data)));
      })
      .expect(200);
    expect((res.body as Buffer).subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('le_modele_de_document_choisi_par_la_societe_change_la_mise_en_page', async () => {
    const version = (
      await hdr(request(app.getHttpServer()).post('/affaires')).send({ code: 'PDF-2', name: 'Villa' })
    ).body.version;
    await hdr(request(app.getHttpServer()).post(`/versions/${version.id}/lines`))
      .send({ type: 'titre', code: '1', designation: 'Gros œuvre' });

    const telecharger = async (): Promise<Buffer> => {
      const r = await hdr(request(app.getHttpServer()).get(`/versions/${version.id}/devis.pdf`))
        .buffer(true)
        .parse((response, cb) => {
          const data: Buffer[] = [];
          response.on('data', (c: Buffer) => data.push(Buffer.from(c)));
          response.on('end', () => cb(null, Buffer.concat(data)));
        })
        .expect(200);
      return r.body as Buffer;
    };

    // Les préférences appartiennent à une société : sans elle, il n'y a rien à préférer.
    await runInTenant(ds, tenantId, (em) =>
      em.query(
        `INSERT INTO company (tenant_id, code, name) VALUES ($1, 'STE', 'Société de test')`,
        [tenantId],
      ));

    // Les modèles proposés viennent du serveur : l'écran ne peut pas en inventer un.
    const modeles = (await hdr(request(app.getHttpServer()).get('/params/modeles-pdf')).expect(200)).body;
    expect(modeles.map((m: { cle: string }) => m.cle)).toContain('bandeau');

    const classique = await telecharger();
    await hdr(request(app.getHttpServer()).patch('/params/preferences'))
      .send({ modelePdf: 'bandeau' }).expect(200);
    const bandeau = await telecharger();

    // Même contenu, mise en page différente : le bandeau dessine un aplat que le classique n'a pas.
    expect(classique.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(bandeau.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(bandeau.length).not.toBe(classique.length);
  });
});
