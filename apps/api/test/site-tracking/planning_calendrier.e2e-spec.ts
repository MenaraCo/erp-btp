import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Calendrier des heures : réalisé et prévisionnel.
 *
 * Le point le plus important tient en une phrase : une heure PRÉVUE ne doit rien coûter. Elle est
 * stockée hors de la table des pointages, précisément pour qu'aucun résultat de chantier ne
 * puisse la compter par mégarde — sinon on afficherait des dépenses qui n'ont pas eu lieu.
 */
describe('Suivi de chantiers — calendrier et prévisionnel', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
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
    ({ tenantId, userId } = await entitleUser(app, ds, 'Planning', 'admin', ['estimating', 'site_tracking']));
    chantierId = (await as('post', '/chantiers').send({ name: 'Chantier planning' }).expect(201)).body.id;
    empId = (
      await as('post', '/employees')
        .send({ firstName: 'Yanis', lastName: 'Bernard', hourlyCost: '30', contractType: 'interimaire', agency: 'Adecco' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('retient l’agence d’intérim sur la fiche', async () => {
    const liste = (await as('get', '/employees').expect(200)).body;
    const y = liste.find((e: { id: string }) => e.id === empId);
    expect(y.contractType).toBe('interimaire');
    expect(y.agency).toBe('Adecco');
  });

  it('duplique une journée type sur une semaine, jours ouvrés seulement', async () => {
    // Du lundi 1er au dimanche 7 juin 2026 → 5 jours ouvrés attendus.
    const r = (
      await as('post', `/chantiers/${chantierId}/planning/dupliquer`)
        .send({ employeeId: empId, hours: '7', debut: '2026-06-01', fin: '2026-06-07', joursOuvres: true })
        .expect(201)
    ).body;
    expect(r.jours).toBe(5);

    const c = (
      await as('get', `/chantiers/${chantierId}/planning?debut=2026-06-01&fin=2026-06-07`).expect(200)
    ).body;
    expect(Number(c.totalPrevu)).toBe(35); // 5 × 7 h
    expect(Number(c.totalRealise)).toBe(0);
    expect(c.jours).toHaveLength(7); // la grille montre aussi le week-end, vide
  });

  it('une heure prévue ne coûte rien tant qu’elle n’a pas eu lieu', async () => {
    const res = (await as('get', `/chantiers/${chantierId}/results`).expect(200)).body;
    const mo = res.byNature.find((n: { nature: string }) => n.nature === 'labor');
    expect(Number(mo?.realise ?? 0)).toBe(0); // le prévisionnel n'entre dans aucun résultat
  });

  it('saisit le réalisé directement dans la grille', async () => {
    await as('put', `/chantiers/${chantierId}/planning/realise`)
      .send({ employeeId: empId, date: '2026-06-01', hours: '8' })
      .expect(200);

    const c = (
      await as('get', `/chantiers/${chantierId}/planning?debut=2026-06-01&fin=2026-06-07`).expect(200)
    ).body;
    const ligne = c.salaries[0];
    expect(Number(ligne.jours['2026-06-01'].realise)).toBe(8);
    expect(Number(ligne.jours['2026-06-01'].prevu)).toBe(7); // le plan reste visible à côté du réel
    expect(Number(c.totalRealise)).toBe(8);
  });

  it('corrige la même case au lieu d’empiler des lignes', async () => {
    await as('put', `/chantiers/${chantierId}/planning/realise`)
      .send({ employeeId: empId, date: '2026-06-01', hours: '6' })
      .expect(200);
    // On relit par la grille : elle renvoie les dates en texte, sans piège de fuseau horaire.
    const c = (
      await as('get', `/chantiers/${chantierId}/planning?debut=2026-06-01&fin=2026-06-07`).expect(200)
    ).body;
    const cellule = c.salaries[0].jours['2026-06-01'];
    expect(Number(cellule.realise)).toBe(6);
    expect(cellule.multiple).toBe(false); // une seule ligne : la correction a remplacé, pas empilé
  });

  it('vider une case efface la saisie', async () => {
    await as('put', `/chantiers/${chantierId}/planning/realise`)
      .send({ employeeId: empId, date: '2026-06-01', hours: '0' })
      .expect(200);
    const c = (
      await as('get', `/chantiers/${chantierId}/planning?debut=2026-06-01&fin=2026-06-07`).expect(200)
    ).body;
    expect(Number(c.totalRealise)).toBe(0);
  });

  it('reporte le prévisionnel en réalisé, sans écraser un jour déjà pointé', async () => {
    // On pointe réellement le mardi, différemment du plan.
    await as('put', `/chantiers/${chantierId}/planning/realise`)
      .send({ employeeId: empId, date: '2026-06-02', hours: '4' })
      .expect(200);

    const r = (
      await as('post', `/chantiers/${chantierId}/planning/reporter`)
        .send({ debut: '2026-06-01', fin: '2026-06-07' })
        .expect(201)
    ).body;
    expect(r.crees).toBe(4);   // lundi, mercredi, jeudi, vendredi
    expect(r.ignores).toBe(0); // le mardi était déjà pointé : il n'est même pas proposé

    const c = (
      await as('get', `/chantiers/${chantierId}/planning?debut=2026-06-01&fin=2026-06-07`).expect(200)
    ).body;
    // 4 jours reportés à 7 h + les 4 h réellement pointées le mardi
    expect(Number(c.totalRealise)).toBe(32);
    expect(Number(c.salaries[0].jours['2026-06-02'].realise)).toBe(4); // le réel a primé
  });

  it('refuse une période aberrante plutôt que de produire une grille illisible', async () => {
    await as('get', `/chantiers/${chantierId}/planning?debut=2026-06-10&fin=2026-06-01`).expect(400);
    await as('get', `/chantiers/${chantierId}/planning?debut=2026-01-01&fin=2026-12-31`).expect(400);
    await as('get', `/chantiers/${chantierId}/planning?debut=juin&fin=2026-06-07`).expect(400);
  });

  it('refuse de résumer un jour ventilé sur plusieurs ouvrages', async () => {
    await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ employeeId: empId, date: '2026-06-15', hours: '3' }).expect(201);
    await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ employeeId: empId, date: '2026-06-15', hours: '4' }).expect(201);

    const r = await as('put', `/chantiers/${chantierId}/planning/realise`)
      .send({ employeeId: empId, date: '2026-06-15', hours: '8' })
      .expect(409);
    expect(JSON.stringify(r.body.message)).toMatch(/détaillée/i);
  });
});
