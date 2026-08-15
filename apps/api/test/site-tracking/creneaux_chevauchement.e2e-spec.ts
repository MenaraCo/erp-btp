import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Créneaux horaires et vrai chevauchement.
 *
 * Sans horaires, deux chantiers le même jour se ressemblent tous : celui qui fait le matin ici et
 * l'après-midi là (normal) déclenchait la même alerte que celui annoncé au même moment à deux
 * endroits (impossible). Trop d'alertes fausses tuent l'alerte : on n'y prête plus attention.
 */
describe('Gestion du personnel — créneaux horaires et chevauchement', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierA: string;
  let chantierB: string;
  let empId: string;

  function as(method: 'get' | 'post', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Creneaux', 'admin', ['estimating', 'site_tracking']));
    chantierA = (await as('post', '/chantiers').send({ name: 'Chantier matin' }).expect(201)).body.id;
    chantierB = (await as('post', '/chantiers').send({ name: 'Chantier après-midi' }).expect(201)).body.id;
    empId = (
      await as('post', '/employees').send({ lastName: 'Ferreira', hourlyCost: '30' }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('déduit la durée du créneau quand les heures ne sont pas saisies', async () => {
    const t = (
      await as('post', `/chantiers/${chantierA}/timesheets`)
        .send({ employeeId: empId, date: '2026-10-05', startTime: '08:00', endTime: '12:30' })
        .expect(201)
    ).body;
    expect(Number(t.hours)).toBe(4.5); // 08:00 → 12:30
    expect(Number(t.cost)).toBe(135);  // 4,5 h × 30 €
  });

  it('refuse un créneau incohérent plutôt que de l’enregistrer', async () => {
    await as('post', `/chantiers/${chantierA}/timesheets`)
      .send({ employeeId: empId, date: '2026-10-06', startTime: '14:00', endTime: '09:00' })
      .expect(400);
    await as('post', `/chantiers/${chantierA}/timesheets`)
      .send({ employeeId: empId, date: '2026-10-06', startTime: '08:00', hours: '4' })
      .expect(400); // une borne seule ne veut rien dire
    await as('post', `/chantiers/${chantierA}/timesheets`)
      .send({ employeeId: empId, date: '2026-10-06', startTime: '8h', endTime: '12h', hours: '4' })
      .expect(400);
  });

  it('ne signale AUCUN conflit quand la journée est proprement partagée', async () => {
    // Matin sur A (déjà saisi), après-midi sur B : c'est le quotidien d'un chantier.
    await as('post', `/chantiers/${chantierB}/timesheets`)
      .send({ employeeId: empId, date: '2026-10-05', startTime: '13:30', endTime: '17:00' })
      .expect(201);

    const c = (await as('get', '/personnel/conflits?debut=2026-10-05&fin=2026-10-05').expect(200)).body;
    expect(c.total).toBe(0);
  });

  it('signale un vrai chevauchement, en nommant les deux créneaux', async () => {
    await as('post', `/chantiers/${chantierA}/timesheets`)
      .send({ employeeId: empId, date: '2026-10-07', startTime: '08:00', endTime: '12:00' })
      .expect(201);
    await as('post', `/chantiers/${chantierB}/timesheets`)
      .send({ employeeId: empId, date: '2026-10-07', startTime: '10:00', endTime: '15:00' })
      .expect(201);

    const c = (await as('get', '/personnel/conflits?debut=2026-10-07&fin=2026-10-07').expect(200)).body;
    expect(c.total).toBe(1);
    expect(c.conflits[0].motifs.join(' ')).toMatch(/au même moment/);
    expect(c.conflits[0].motifs.join(' ')).toMatch(/08:00–12:00/);
  });

  it('reste vigilant quand les horaires manquent : on ne peut pas trancher', async () => {
    await as('post', `/chantiers/${chantierA}/timesheets`)
      .send({ employeeId: empId, date: '2026-10-08', hours: '4' }).expect(201);
    await as('post', `/chantiers/${chantierB}/timesheets`)
      .send({ employeeId: empId, date: '2026-10-08', hours: '4' }).expect(201);

    const c = (await as('get', '/personnel/conflits?debut=2026-10-08&fin=2026-10-08').expect(200)).body;
    expect(c.total).toBe(1);
    expect(c.conflits[0].motifs.join(' ')).toMatch(/2 chantiers le même jour/);
  });

  it('expose les créneaux dans la vue d’occupation', async () => {
    const v = (await as('get', '/personnel/occupation?debut=2026-10-05&fin=2026-10-05').expect(200)).body;
    const jour = v.salaries[0].jours['2026-10-05'];
    const matin = jour.chantiers.find((c: { debut: string | null }) => c.debut === '08:00');
    expect(matin.fin).toBe('12:30');
  });
});
