import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Le panneau de contrôles lit cet endpoint en continu pendant la vie du devis : il doit citer la
 * ligne fautive par son numéro hiérarchique, celui que l'utilisateur voit à l'écran.
 */
describe('Études de prix — contrôles de cohérence du devis', () => {
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
    // Le référentiel clients relève du socle : sans lui, on ne peut pas rattacher de client.
    ({ tenantId, userId } = await entitleUser(app, ds, 'Ctrl', 'admin', ['estimating', 'core']));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('remonte les oublis d’une ligne en la citant par son numéro', async () => {
    const created = (await as('post', '/affaires').send({ code: 'CTL-1', name: 'CTL-1' }).expect(201)).body;
    const v = created.version.id;
    const titre = (
      await as('post', `/versions/${v}/lines`)
        .send({ type: 'titre', code: '1', designation: 'TRAVAUX', sortOrder: 1 })
        .expect(201)
    ).body;
    // Ressource incomplète : ni unité, ni prix, ni code analytique.
    await as('post', `/versions/${v}/lines`)
      .send({
        type: 'ressource', parentLineId: titre.id, code: 'R1', designation: 'Peinture',
        quantity: '10', nature: 'material',
      })
      .expect(201);

    const res = (await as('get', `/versions/${v}/controles`).expect(200)).body;
    const codes = res.controles.map((c: { code: string }) => c.code);
    expect(codes).toContain('unite_manquante');
    expect(codes).toContain('pu_manquant'); // prix jamais saisi — distinct d'un prix mis à zéro
    expect(codes).toContain('code_analytique_manquant');
    // Feuille de vente pas encore enregistrée sur ce devis neuf.
    expect(codes).toContain('coefficients_absents');

    const unite = res.controles.find((c: { code: string }) => c.code === 'unite_manquante');
    // Une ressource n'a pas de numéro propre : elle est situee par le titre qui la porte.
    expect(unite.ligne).toBe('1 › Peinture');
    expect(unite.lineId).toBeDefined();
    expect(res.compte.avertissement).toBeGreaterThan(0);
  });

  it('se tait sur un devis complet', async () => {
    const created = (await as('post', '/affaires').send({ code: 'CTL-2', name: 'CTL-2' }).expect(201)).body;
    const v = created.version.id;
    const plan = (await as('get', '/analytical/plan').expect(200)).body;
    const code = plan
      .flatMap((n: { lots: { familles: { codes: { code: string }[] }[] }[] }) => n.lots)
      .flatMap((l: { familles: { codes: { code: string }[] }[] }) => l.familles)
      .flatMap((f: { codes: { code: string }[] }) => f.codes)[0];
    const titre = (
      await as('post', `/versions/${v}/lines`)
        .send({ type: 'titre', code: '1', designation: 'TRAVAUX', sortOrder: 1 })
        .expect(201)
    ).body;
    await as('post', `/versions/${v}/lines`)
      .send({
        type: 'ressource', parentLineId: titre.id, code: 'R1', designation: 'Peinture',
        unit: 'M2', quantity: '10', pu: '25', nature: 'material', codeAnalytique: code.code,
      })
      .expect(201);
    await as('put', `/versions/${v}/sale-sheet`)
      .send({
        byNature: {
          labor: { tauxFg: '10', tauxBenefice: '15' },
          material: { tauxFg: '10', tauxBenefice: '15' },
          equipment: { tauxFg: '10', tauxBenefice: '15' },
          subcontract: { tauxFg: '10', tauxBenefice: '15' },
        },
        tvaRate: '0.20',
      })
      .expect(200);
    // Un client sur l'affaire : sinon le devis ne peut être adressé à personne.
    const client = (
      await as('post', '/clients').send({ code: 'CLI-CTL', name: 'Client contrôle' }).expect(201)
    ).body;
    await as('patch', `/affaires/${created.affaire.id}`).send({ clientId: client.id }).expect(200);

    const res = (await as('get', `/versions/${v}/controles`).expect(200)).body;
    expect(res.controles).toEqual([]);
    expect(res.compte).toEqual({ bloquant: 0, avertissement: 0, info: 0 });
  });

  it('refuse (404) une version inconnue', async () => {
    await as('get', '/versions/00000000-0000-0000-0000-000000000000/controles').expect(404);
  });
});
