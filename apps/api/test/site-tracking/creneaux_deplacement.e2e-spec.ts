import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Créneaux individuels et déplacement — ce que le glisser-déposer appelle.
 *
 * Déplacer une journée d'un jour à l'autre est le geste le plus fréquent d'un conducteur qui
 * réorganise sa semaine. Deux garde-fous : un créneau réalisé et ARRÊTÉ ne bouge pas (il alimente
 * un résultat publié), et déposer un prévisionnel sur un jour déjà planifié remplace la valeur
 * plutôt que d'échouer sur une contrainte technique.
 */
describe('Gestion du personnel — déplacement des créneaux', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let empId: string;

  function as(method: 'get' | 'post' | 'patch', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'patch' ? request(s).patch(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  const creneauxDe = async (debut: string, fin: string) =>
    (await as('get', `/personnel/creneaux?debut=${debut}&fin=${fin}`).expect(200)).body;

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Deplacement', 'admin', ['estimating', 'site_tracking']));
    chantierId = (await as('post', '/chantiers').send({ name: 'Chantier souris' }).expect(201)).body.id;
    empId = (await as('post', '/employees').send({ lastName: 'Mendes', hourlyCost: '40' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('liste les créneaux un par un, avec leur identifiant', async () => {
    await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ employeeId: empId, date: '2026-11-02', startTime: '08:00', endTime: '12:00' })
      .expect(201);
    await as('post', `/chantiers/${chantierId}/planning/dupliquer`)
      .send({ employeeId: empId, hours: '7', debut: '2026-11-03', fin: '2026-11-03' })
      .expect(201);

    const r = await creneauxDe('2026-11-02', '2026-11-06');
    expect(r.creneaux).toHaveLength(2);
    const reel = r.creneaux.find((c: { kind: string }) => c.kind === 'realise');
    expect(reel.debut).toBe('08:00');
    expect(reel.chantierCode).toBeTruthy();
    expect(r.creneaux.some((c: { kind: string }) => c.kind === 'prevu')).toBe(true);
  });

  it('déplace un créneau réalisé sur un autre jour, et recalcule son coût', async () => {
    const r = await creneauxDe('2026-11-02', '2026-11-06');
    const reel = r.creneaux.find((c: { kind: string }) => c.kind === 'realise');

    const m = (
      await as('patch', `/personnel/creneaux/realise/${reel.id}`)
        .send({ date: '2026-11-05', debut: '09:00', fin: '17:00' })
        .expect(200)
    ).body;
    expect(m.date).toBe('2026-11-05');
    expect(Number(m.heures)).toBe(8); // la durée suit le nouveau créneau

    const liste = (await as('get', `/chantiers/${chantierId}/timesheets`).expect(200)).body;
    const ligne = liste.find((l: { id: string }) => l.id === reel.id);
    expect(Number(ligne.cost)).toBe(320); // 8 h × 40 €
  });

  it('déposer un prévisionnel sur un jour déjà planifié remplace au lieu d’échouer', async () => {
    await as('post', `/chantiers/${chantierId}/planning/dupliquer`)
      .send({ employeeId: empId, hours: '5', debut: '2026-11-04', fin: '2026-11-04' })
      .expect(201);

    const avant = await creneauxDe('2026-11-03', '2026-11-04');
    const du3 = avant.creneaux.find((c: { kind: string; date: string }) => c.kind === 'prevu' && c.date === '2026-11-03');

    await as('patch', `/personnel/creneaux/prevu/${du3.id}`).send({ date: '2026-11-04' }).expect(200);

    const apres = await creneauxDe('2026-11-03', '2026-11-04');
    const prevus = apres.creneaux.filter((c: { kind: string }) => c.kind === 'prevu');
    expect(prevus).toHaveLength(1); // l'ancienne prévision du 4 a cédé la place
    expect(prevus[0].date).toBe('2026-11-04');
    expect(Number(prevus[0].heures)).toBe(7); // celle qu'on a déplacée
  });

  it('refuse de déplacer un créneau arrêté', async () => {
    await as('post', `/chantiers/${chantierId}/timesheets/imputation`).send({ mois: '2026-11' }).expect(201);

    const r = await creneauxDe('2026-11-01', '2026-11-30');
    const fige = r.creneaux.find((c: { kind: string; fige: boolean }) => c.kind === 'realise' && c.fige);
    expect(fige).toBeTruthy();

    const refus = await as('patch', `/personnel/creneaux/realise/${fige.id}`)
      .send({ date: '2026-11-20' })
      .expect(409);
    expect(JSON.stringify(refus.body.message)).toMatch(/arrêté/i);
  });

  it('refuse un type de créneau inconnu', async () => {
    await as('patch', '/personnel/creneaux/autre/00000000-0000-0000-0000-000000000000')
      .send({ date: '2026-11-20' })
      .expect(400);
  });
});
