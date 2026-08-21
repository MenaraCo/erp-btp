import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Ventiler ce qui est arrivé sans code — et CORRIGER ce qui est mal rangé.
 *
 * Une dépense sans code analytique est comptée dans le total du chantier mais dans aucun poste :
 * elle reste dans « 999 — À ventiler ». Seule la nomenclature pouvait être classée ; l'engagé
 * d'une commande, une facture ou des heures y restaient pour toujours, faute d'écran.
 *
 * Et une imputation se corrige : on découvre en cours de chantier qu'une ressource était du
 * matériel, pas de la main-d'œuvre. Le seul refus légitime porte sur ce qui est FIGÉ.
 */
describe('Contrôle de gestion — ventilation et correction d’imputation', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let codeA: string;
  let codeB: string;
  let ligneCommande: string;

  function as(method: 'get' | 'post' | 'patch', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'patch' ? request(s).patch(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(
      app, ds, 'Vent', 'admin', ['site_tracking', 'core', 'estimating', 'financial_management'],
    ));

    chantierId = (await as('post', '/chantiers').send({ name: 'Tour Nord' }).expect(201)).body.id;
    const lotId = (await as('post', '/params/lots').send({ code: 'GO', label: 'Gros œuvre' }).expect(201)).body.id;
    const familleId = (await as('post', '/params/familles')
      .send({ lotId, code: 'MAC', label: 'Maçonnerie', nature: 'material' }).expect(201)).body.id;
    codeA = (await as('post', '/params/codes')
      .send({ familleId, code: '280', label: 'Colle' }).expect(201)).body.id;
    codeB = (await as('post', '/params/codes')
      .send({ familleId, code: '281', label: 'Adhésif' }).expect(201)).body.id;

    // Une commande ENVOYÉE dont une ligne est partie sans code analytique (reprise de données).
    const bc = (await as('post', `/chantiers/${chantierId}/purchase-orders`).send({}).expect(201)).body;
    ligneCommande = (await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({ nature: 'material', designation: 'Sacs de colle', quantity: '10', unitPrice: '50',
        codeAnalytiqueId: codeA })
      .expect(201)).body.id;
    await as('post', `/purchase-orders/${bc.id}/submit`).expect(201);
    // On efface l'imputation comme le ferait une reprise : la ligne tombe « à ventiler ».
    await as('patch', `/chantiers/${chantierId}/ventilation/commande/${ligneCommande}`)
      .send({ codeAnalytiqueId: null })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('liste_tout_ce_qui_n_a_pas_de_code_budget_engage_et_realise', async () => {
    const r = (await as('get', `/chantiers/${chantierId}/a-ventiler`).expect(200)).body;
    expect(r.commandes).toHaveLength(1);
    expect(r.commandes[0].label).toBe('Sacs de colle');
    expect(Number(r.totaux.engage)).toBe(500);
    // Les trois axes sont renvoyés ensemble : c'est une liste de travail, pas trois écrans.
    expect(r).toHaveProperty('ressources');
    expect(r).toHaveProperty('factures');
    expect(r).toHaveProperty('pointages');
  });

  it('impute_l_engage_d_une_commande_deja_envoyee', async () => {
    // Le code analytique ne regarde que notre comptabilité : rouvrir la commande pour le corriger
    // reviendrait à mentir sur son statut.
    await as('patch', `/chantiers/${chantierId}/ventilation/commande/${ligneCommande}`)
      .send({ codeAnalytiqueId: codeA })
      .expect(200);

    const apres = (await as('get', `/chantiers/${chantierId}/a-ventiler`).expect(200)).body;
    expect(apres.commandes).toHaveLength(0);
    expect(Number(apres.totaux.engage)).toBe(0);
  });

  it('corrige_une_imputation_deja_posee_autant_de_fois_qu_il_le_faut', async () => {
    await as('patch', `/chantiers/${chantierId}/ventilation/commande/${ligneCommande}`)
      .send({ codeAnalytiqueId: codeB })
      .expect(200);

    const resultats = (await as('get', `/chantiers/${chantierId}/analytical-results`).expect(200)).body;
    const codes = resultats.natures
      .flatMap((n: { lots: Array<{ familles: Array<{ codes: Array<{ code: string; metrics: Record<string, string> }> }> }> }) =>
        n.lots.flatMap((l) => l.familles.flatMap((f) => f.codes)));
    const surB = codes.find((c: { code: string }) => c.code === '281');
    const surA = codes.find((c: { code: string }) => c.code === '280');
    expect(Number(surB?.metrics.engage ?? 0)).toBe(500);
    expect(Number(surA?.metrics.engage ?? 0)).toBe(0);
  });

  it('refuse_de_reclasser_des_heures_dont_le_mois_est_arrete', async () => {
    const employeeId = (await as('post', '/employees')
      .send({ lastName: 'Durand', hourlyCost: '20' }).expect(201)).body.id;
    const pointage = (await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ employeeId, date: '2026-04-06', hours: '7', hourlyCost: '20' })
      .expect(201)).body;

    // Tant que le mois est ouvert, l'imputation se corrige.
    await as('patch', `/chantiers/${chantierId}/ventilation/pointage/${pointage.id}`)
      .send({ codeAnalytiqueId: codeA })
      .expect(200);

    await as('post', `/chantiers/${chantierId}/timesheets/imputation`).send({ mois: '2026-04' }).expect(201);
    await as('patch', `/chantiers/${chantierId}/ventilation/pointage/${pointage.id}`)
      .send({ codeAnalytiqueId: codeB })
      .expect(400);
  });
});
