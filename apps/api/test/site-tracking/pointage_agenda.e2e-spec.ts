import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Agenda des pointages : lecture par période, correction, et gel.
 *
 * Deux règles se tiennent ici : on ne charge que la période affichée (un agenda ne montre qu'un
 * mois), et une saisie reste corrigeable TANT QU'ELLE N'EST PAS FIGÉE — imputée au résultat, ou
 * couverte par un relevé de paye signé. Modifier après coup ferait mentir un document signé.
 */
describe('Suivi de chantiers — agenda des pointages', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let employeeId: string;
  let pointageId: string;

  function as(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'patch' ? request(s).patch(path)
        : method === 'delete' ? request(s).delete(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Agd', 'admin', ['site_tracking', 'core']));

    chantierId = (await as('post', '/chantiers').send({ name: 'Tour Nord' }).expect(201)).body.id;
    employeeId = (await as('post', '/employees')
      .send({ lastName: 'Durand', firstName: 'Paul', hourlyCost: '20' }).expect(201)).body.id;

    pointageId = (await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ employeeId, date: '2026-05-11', hours: '8', hourlyCost: '20' })
      .expect(201)).body.id;
    await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ employeeId, date: '2026-06-02', hours: '7', hourlyCost: '20' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('ne_charge_que_la_periode_affichee', async () => {
    const mai = (await as('get', `/chantiers/${chantierId}/timesheets?debut=2026-04-27&fin=2026-06-07`)
      .expect(200)).body;
    expect(mai).toHaveLength(2);

    const semaine = (await as('get', `/chantiers/${chantierId}/timesheets?debut=2026-05-11&fin=2026-05-17`)
      .expect(200)).body;
    expect(semaine).toHaveLength(1);
    expect(semaine[0].work_date).toBe('2026-05-11');
    // L'écran a besoin de savoir AVANT d'afficher un crayon qui ne marcherait pas.
    expect(semaine[0].impute).toBe(false);
    expect(semaine[0].releve_signe).toBe(false);
  });

  it('corrige_une_saisie_tant_qu_elle_n_est_pas_figee', async () => {
    const corrige = (await as('patch', `/chantiers/${chantierId}/timesheets/${pointageId}`)
      .send({ hours: '6.5' })
      .expect(200)).body;
    expect(Number(corrige.hours)).toBe(6.5);
    expect(Number(corrige.cost)).toBe(130);      // 6,5 × 20 €, recalculé
  });

  it('un_releve_de_paye_signe_fige_les_heures_du_mois', async () => {
    const codeAnalytiqueId = await (async () => {
      const lotId = (await as('post', '/params/lots').send({ code: 'MO', label: 'MO' }).expect(201)).body.id;
      const familleId = (await as('post', '/params/familles')
        .send({ lotId, code: 'IND', label: 'Indemnités' }).expect(201)).body.id;
      return (await as('post', '/params/codes')
        .send({ familleId, code: '910', label: 'Paniers' }).expect(201)).body.id;
    })();
    await as('post', '/paye/rubriques')
      .send({
        code: 'PAN', label: 'Panier', type: 'panier', unite: 'jour',
        montantUnitaire: '11.50', codeAnalytiqueId,
      })
      .expect(201);

    await as('post', `/paye/releves/${employeeId}/calculer?mois=2026-05`).expect(201);
    await as('post', `/paye/releves/${employeeId}/valider?mois=2026-05`).expect(201);
    await as('post', `/paye/releves/${employeeId}/signer?mois=2026-05`)
      .send({ nom: 'Paul Durand' }).expect(201);

    // Le mois signé se ferme…
    await as('patch', `/chantiers/${chantierId}/timesheets/${pointageId}`)
      .send({ hours: '9' })
      .expect(409);
    const fige = (await as('get', `/chantiers/${chantierId}/timesheets?debut=2026-05-01&fin=2026-05-31`)
      .expect(200)).body;
    expect(fige[0].releve_signe).toBe(true);

    // …mais le mois suivant, lui, reste ouvert : le gel est mensuel, pas définitif.
    const juin = (await as('get', `/chantiers/${chantierId}/timesheets?debut=2026-06-01&fin=2026-06-30`)
      .expect(200)).body;
    expect(juin[0].releve_signe).toBe(false);
    await as('patch', `/chantiers/${chantierId}/timesheets/${juin[0].id}`)
      .send({ hours: '7.5' })
      .expect(200);

    // Rouvrir le relevé rend la correction possible de nouveau.
    await as('post', `/paye/releves/${employeeId}/rouvrir?mois=2026-05`).send({}).expect(201);
    await as('patch', `/chantiers/${chantierId}/timesheets/${pointageId}`)
      .send({ hours: '9' })
      .expect(200);
  });
});
