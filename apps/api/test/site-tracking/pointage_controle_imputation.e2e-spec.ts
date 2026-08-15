import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Corriger, contrôler, puis arrêter les heures d'un mois.
 *
 * Jusqu'ici un pointage ne pouvait être ni corrigé ni supprimé : une faute de frappe polluait le
 * réalisé à vie. À l'inverse, une fois les heures imputées, elles alimentent un résultat de
 * chantier parfois déjà présenté au client — les laisser bouger ferait mentir un chiffre publié.
 * Ces tests verrouillent les deux bouts.
 */
describe('Suivi de chantiers — contrôle et imputation des pointages', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let empId: string;

  function as(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
    const s = app.getHttpServer();
    const base =
      method === 'get' ? request(s).get(path)
        : method === 'patch' ? request(s).patch(path)
          : method === 'delete' ? request(s).delete(path)
            : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  const pointer = (body: Record<string, unknown>) =>
    as('post', `/chantiers/${chantierId}/timesheets`).send(body);

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Controle', 'admin', ['estimating', 'site_tracking']));
    chantierId = (await as('post', '/chantiers').send({ name: 'Chantier contrôle' }).expect(201)).body.id;
    empId = (
      await as('post', '/employees').send({ firstName: 'Ana', lastName: 'Silva', hourlyCost: '30' }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('corrige une faute de frappe tant que le mois n’est pas arrêté', async () => {
    const t = (await pointer({ employeeId: empId, date: '2026-04-02', hours: '80' }).expect(201)).body;
    expect(Number(t.cost)).toBe(2400); // 80 h × 30 € : la faute de frappe classique

    const corrige = (
      await as('patch', `/chantiers/${chantierId}/timesheets/${t.id}`).send({ hours: '8' }).expect(200)
    ).body;
    expect(Number(corrige.hours)).toBe(8);
    expect(Number(corrige.cost)).toBe(240); // le coût suit la correction
  });

  it('supprime un pointage saisi par erreur', async () => {
    const t = (await pointer({ employeeId: empId, date: '2026-04-03', hours: '7' }).expect(201)).body;
    await as('delete', `/chantiers/${chantierId}/timesheets/${t.id}`).expect(200);
    const liste = (await as('get', `/chantiers/${chantierId}/timesheets`).expect(200)).body;
    expect(liste.some((l: { id: string }) => l.id === t.id)).toBe(false);
  });

  it('signale les anomalies du mois sans les interdire', async () => {
    await pointer({ employeeId: empId, date: '2026-04-06', hours: '14' }).expect(201); // journée trop longue
    await pointer({ employee: 'Renfort ponctuel', date: '2026-04-07', hours: '8', hourlyCost: '0' }).expect(201);

    const c = (await as('get', `/chantiers/${chantierId}/timesheets/controle?mois=2026-04`).expect(200)).body;
    const motifs = c.salaries.flatMap((s: { anomalies: string[] }) => s.anomalies).join(' | ');
    expect(motifs).toMatch(/anormalement longue/);
    expect(motifs).toMatch(/Coût horaire à 0/);
    expect(motifs).toMatch(/Nom saisi à la main/);
    expect(c.anomalies).toBeGreaterThan(0);
    expect(c.impute).toBe(false);
  });

  it('totalise les heures et le coût du mois, par salarié', async () => {
    const c = (await as('get', `/chantiers/${chantierId}/timesheets/controle?mois=2026-04`).expect(200)).body;
    const ana = c.salaries.find((s: { employeeId: string | null }) => s.employeeId === empId);
    // 8 h (corrigées) + 14 h = 22 h à 30 €
    expect(Number(ana.heures)).toBe(22);
    expect(Number(ana.cout)).toBe(660);
    expect(Number(c.totalHeures)).toBe(30); // + les 8 h du renfort
  });

  it('refuse un mois mal écrit plutôt que de deviner', async () => {
    await as('get', `/chantiers/${chantierId}/timesheets/controle?mois=avril`).expect(400);
    await as('get', `/chantiers/${chantierId}/timesheets/controle?mois=2026-13`).expect(400);
  });

  it('arrête le mois, puis fige les heures', async () => {
    const r = (
      await as('post', `/chantiers/${chantierId}/timesheets/imputation`).send({ mois: '2026-04' }).expect(201)
    ).body;
    expect(r.imputes).toBeGreaterThan(0);

    const c = (await as('get', `/chantiers/${chantierId}/timesheets/controle?mois=2026-04`).expect(200)).body;
    expect(c.impute).toBe(true);
  });

  it('refuse ensuite toute modification ou suppression, en disant quoi faire', async () => {
    const liste = (await as('get', `/chantiers/${chantierId}/timesheets`).expect(200)).body;
    const impute = liste.find((l: { imputed_at: string | null }) => l.imputed_at !== null);

    const r = await as('patch', `/chantiers/${chantierId}/timesheets/${impute.id}`).send({ hours: '1' }).expect(409);
    expect(JSON.stringify(r.body.message)).toMatch(/correction/i);
    await as('delete', `/chantiers/${chantierId}/timesheets/${impute.id}`).expect(409);
  });

  it('n’impute pas deux fois les mêmes heures', async () => {
    const r = (
      await as('post', `/chantiers/${chantierId}/timesheets/imputation`).send({ mois: '2026-04' }).expect(201)
    ).body;
    expect(r.imputes).toBe(0); // tout était déjà arrêté
  });

  it('laisse le mois suivant libre à la saisie', async () => {
    const t = (await pointer({ employeeId: empId, date: '2026-05-04', hours: '6' }).expect(201)).body;
    await as('patch', `/chantiers/${chantierId}/timesheets/${t.id}`).send({ hours: '5' }).expect(200);
  });
});
