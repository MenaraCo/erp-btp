import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

/**
 * Vue d'entreprise du personnel et détection des conflits.
 *
 * Le pointage se saisit chantier par chantier, mais un salarié se répartit entre plusieurs. Sans
 * vue globale, personne ne voit qu'un maçon a été pointé le même jour sur deux chantiers : chacun
 * a raison de son côté, et l'entreprise compte deux fois la même journée dans ses résultats.
 *
 * Un conflit n'est jamais BLOQUÉ : passer d'un chantier à l'autre dans la journée est légitime.
 * Il est signalé, le conducteur tranche.
 */
describe('Gestion du personnel — occupation et conflits', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierA: string;
  let chantierB: string;
  let empId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'put' ? request(s).put(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Personnel', 'admin', ['estimating', 'site_tracking']));
    chantierA = (await as('post', '/chantiers').send({ name: 'Chantier A' }).expect(201)).body.id;
    chantierB = (await as('post', '/chantiers').send({ name: 'Chantier B' }).expect(201)).body.id;
    empId = (
      await as('post', '/employees').send({ firstName: 'Sofia', lastName: 'Nunes', hourlyCost: '30' }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('rassemble l’occupation d’un salarié sur TOUS les chantiers', async () => {
    await as('post', `/chantiers/${chantierA}/timesheets`)
      .send({ employeeId: empId, date: '2026-09-07', hours: '4' }).expect(201);
    await as('post', `/chantiers/${chantierB}/timesheets`)
      .send({ employeeId: empId, date: '2026-09-08', hours: '7' }).expect(201);

    const v = (await as('get', '/personnel/occupation?debut=2026-09-07&fin=2026-09-11').expect(200)).body;
    const sofia = v.salaries.find((s: { employeeId: string }) => s.employeeId === empId);
    expect(Object.keys(sofia.jours).sort()).toEqual(['2026-09-07', '2026-09-08']);
    expect(Number(sofia.totalHeures)).toBe(11);
    expect(v.conflits).toBe(0); // deux chantiers, mais des jours différents : rien d'anormal
  });

  it('signale un salarié pointé le même jour sur deux chantiers', async () => {
    await as('post', `/chantiers/${chantierB}/timesheets`)
      .send({ employeeId: empId, date: '2026-09-07', hours: '4' }).expect(201);

    const v = (await as('get', '/personnel/occupation?debut=2026-09-07&fin=2026-09-11').expect(200)).body;
    const sofia = v.salaries.find((s: { employeeId: string }) => s.employeeId === empId);
    const jour = sofia.jours['2026-09-07'];
    expect(jour.chantiers).toHaveLength(2);
    expect(jour.conflits.join(' ')).toMatch(/2 chantiers le même jour/);
    expect(v.conflits).toBeGreaterThan(0);
  });

  it('signale un cumul de journée impossible', async () => {
    await as('post', `/chantiers/${chantierA}/timesheets`)
      .send({ employeeId: empId, date: '2026-09-09', hours: '9' }).expect(201);
    await as('post', `/chantiers/${chantierB}/timesheets`)
      .send({ employeeId: empId, date: '2026-09-09', hours: '5' }).expect(201);

    const c = (await as('get', '/personnel/conflits?debut=2026-09-07&fin=2026-09-11').expect(200)).body;
    const journee = c.conflits.find((x: { date: string }) => x.date === '2026-09-09');
    expect(Number(journee.totalHeures)).toBe(14);
    expect(journee.motifs.join(' ')).toMatch(/journée impossible/);
  });

  it('ne bloque jamais la saisie : le conflit est signalé, pas interdit', async () => {
    // Les quatre pointages précédents ont tous été acceptés (201) — c'est le sujet du test.
    const c = (await as('get', '/personnel/conflits?debut=2026-09-07&fin=2026-09-11').expect(200)).body;
    expect(c.total).toBeGreaterThan(0);
  });

  it('filtre par salarié, par chantier et par contrat', async () => {
    const autre = (
      await as('post', '/employees').send({ lastName: 'Autre', hourlyCost: '25', contractType: 'interimaire' }).expect(201)
    ).body.id;
    await as('post', `/chantiers/${chantierA}/timesheets`)
      .send({ employeeId: autre, date: '2026-09-10', hours: '8' }).expect(201);

    const parChantier = (
      await as('get', `/personnel/occupation?debut=2026-09-07&fin=2026-09-11&chantier=${chantierB}`).expect(200)
    ).body;
    expect(parChantier.salaries.every((s: { employeeId: string }) => s.employeeId === empId)).toBe(true);

    const parContrat = (
      await as('get', '/personnel/occupation?debut=2026-09-07&fin=2026-09-11&contrat=interimaire').expect(200)
    ).body;
    expect(parContrat.salaries).toHaveLength(1);
    expect(parContrat.salaries[0].employeeId).toBe(autre);

    const parSalarie = (
      await as('get', `/personnel/occupation?debut=2026-09-07&fin=2026-09-11&salarie=${empId}`).expect(200)
    ).body;
    expect(parSalarie.salaries).toHaveLength(1);
  });

  it('distingue le prévisionnel du réalisé, et ne le compte pas comme un conflit', async () => {
    await as('post', `/chantiers/${chantierA}/planning/dupliquer`)
      .send({ employeeId: empId, hours: '7', debut: '2026-09-14', fin: '2026-09-15' }).expect(201);
    await as('post', `/chantiers/${chantierB}/planning/dupliquer`)
      .send({ employeeId: empId, hours: '7', debut: '2026-09-14', fin: '2026-09-15' }).expect(201);

    const v = (await as('get', '/personnel/occupation?debut=2026-09-14&fin=2026-09-15').expect(200)).body;
    const sofia = v.salaries.find((s: { employeeId: string }) => s.employeeId === empId);
    expect(Number(sofia.totalPrevu)).toBe(28); // 2 chantiers × 2 jours × 7 h
    expect(Number(sofia.totalHeures)).toBe(0); // rien de réalisé
    expect(v.conflits).toBe(0); // un plan qui se chevauche s'ajuste encore, ce n'est pas une erreur
  });

  it('les heures héritent du code analytique du salarié', async () => {
    // Le plan analytique (nature → lot → famille → code) est propre à chaque société : on le
    // crée ici, le tenant de test n'en a pas.
    const codeId = await runInTenant(ds, tenantId, async (em) => {
      // La nature est une colonne du lot : nature → lot → famille → code.
      const lot = (await em.query(
        `INSERT INTO analytical_lot (tenant_id, nature, code, label)
         VALUES ($1,'labor','L1','Lot main-d’œuvre') RETURNING id`,
        [tenantId],
      ))[0].id;
      const famille = (await em.query(
        `INSERT INTO analytical_famille (tenant_id, lot_id, code, label) VALUES ($1,$2,'F1','Famille') RETURNING id`,
        [tenantId, lot],
      ))[0].id;
      return (await em.query(
        `INSERT INTO analytical_code (tenant_id, famille_id, code, label)
         VALUES ($1,$2,'MO-TEST','Main-d’œuvre test') RETURNING id`,
        [tenantId, famille],
      ))[0].id as string;
    });

    const emp = (
      await as('post', '/employees')
        .send({ lastName: 'Analytique', hourlyCost: '20', codeAnalytiqueId: codeId })
        .expect(201)
    ).body;
    expect(emp.codeAnalytiqueId).toBe(codeId);

    const t = (
      await as('post', `/chantiers/${chantierA}/timesheets`)
        .send({ employeeId: emp.id, date: '2026-09-16', hours: '8' })
        .expect(201)
    ).body;
    // Sans ce report, l'heure tombait hors analytique et les résultats par code étaient faux.
    expect(t.code_analytique_id).toBe(codeId);
  });
});
