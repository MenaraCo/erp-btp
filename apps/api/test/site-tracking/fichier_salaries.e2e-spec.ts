import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Fichier des salariés et son usage au pointage.
 *
 * Le pointage désignait l'ouvrier par un texte libre : deux orthographes du même nom créaient
 * deux personnes, et le coût horaire était ressaisi à chaque ligne — donc parfois faux. Ces tests
 * verrouillent ce qui fait la valeur de la fiche : le coût horaire vient d'elle (et une heure
 * coûte donc le même prix partout), tout en restant forçable quand la réalité l'exige.
 */
describe('Suivi de chantiers — fichier des salariés', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;

  function as(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
    const s = app.getHttpServer();
    const base =
      method === 'get' ? request(s).get(path)
        : method === 'patch' ? request(s).patch(path)
          : method === 'delete' ? request(s).delete(path)
            : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Salaries', 'admin', ['estimating', 'site_tracking']));
    chantierId = (
      await as('post', '/chantiers').send({ name: 'Chantier pointage' }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('attribue un code automatiquement, comme les autres fiches', async () => {
    const a = (await as('post', '/employees').send({ firstName: 'Marc', lastName: 'Dubois', jobTitle: 'Maçon', hourlyCost: '32.50' }).expect(201)).body;
    const b = (await as('post', '/employees').send({ lastName: 'Roux', hourlyCost: '28' }).expect(201)).body;
    expect(a.code).toMatch(/^SAL-\d{4}$/);
    expect(b.code).not.toBe(a.code); // la séquence avance
    expect(a.fullName).toBe('Marc Dubois');
  });

  it('refuse une fiche sans nom, et un coût horaire négatif', async () => {
    await as('post', '/employees').send({ firstName: 'Sans', hourlyCost: '10' }).expect(400);
    await as('post', '/employees').send({ lastName: 'Négatif', hourlyCost: '-5' }).expect(400);
  });

  it('le pointage reprend le nom ET le coût horaire de la fiche', async () => {
    const emp = (
      await as('post', '/employees').send({ firstName: 'Léa', lastName: 'Martin', hourlyCost: '40' }).expect(201)
    ).body;

    const t = (
      await as('post', `/chantiers/${chantierId}/timesheets`)
        .send({ employeeId: emp.id, date: '2026-03-10', hours: '7' })
        .expect(201)
    ).body;

    expect(t.employee_label).toBe('Léa Martin'); // plus de saisie libre à ré-orthographier
    expect(Number(t.hourly_cost)).toBe(40);
    expect(Number(t.cost)).toBe(280); // 7 h × 40 €
  });

  it('laisse forcer le coût horaire quand la réalité l’exige (heure de nuit, intérim)', async () => {
    const emp = (
      await as('post', '/employees').send({ lastName: 'Nuit', hourlyCost: '40' }).expect(201)
    ).body;
    const t = (
      await as('post', `/chantiers/${chantierId}/timesheets`)
        .send({ employeeId: emp.id, date: '2026-03-11', hours: '2', hourlyCost: '60' })
        .expect(201)
    ).body;
    expect(Number(t.cost)).toBe(120); // 2 h × 60 €, et non le taux de la fiche
  });

  it('accepte encore un nom libre quand aucune fiche n’existe (intérim de passage)', async () => {
    const t = (
      await as('post', `/chantiers/${chantierId}/timesheets`)
        .send({ employee: 'Intérimaire Dupont', date: '2026-03-12', hours: '8', hourlyCost: '35' })
        .expect(201)
    ).body;
    expect(t.employee_label).toBe('Intérimaire Dupont');
    expect(t.employee_id).toBeNull();
  });

  it('exige au moins un salarié ou un nom', async () => {
    await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ date: '2026-03-13', hours: '8' })
      .expect(400);
  });

  it('désactive au lieu de supprimer un salarié qui a déjà pointé', async () => {
    const emp = (await as('post', '/employees').send({ lastName: 'APointé', hourlyCost: '30' }).expect(201)).body;
    await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ employeeId: emp.id, date: '2026-03-14', hours: '4' })
      .expect(201);

    // Ses heures composent le réalisé du chantier : les effacer fausserait un résultat publié.
    const r = (await as('delete', `/employees/${emp.id}`).expect(200)).body;
    expect(r).toEqual({ deleted: false, deactivated: true });

    const actifs = (await as('get', '/employees').expect(200)).body;
    expect(actifs.some((e: { id: string }) => e.id === emp.id)).toBe(false);
    const tous = (await as('get', '/employees?tous=1').expect(200)).body;
    expect(tous.some((e: { id: string }) => e.id === emp.id)).toBe(true);
  });

  it('supprime réellement un salarié qui n’a jamais pointé', async () => {
    const emp = (await as('post', '/employees').send({ lastName: 'JamaisPointé' }).expect(201)).body;
    const r = (await as('delete', `/employees/${emp.id}`).expect(200)).body;
    expect(r).toEqual({ deleted: true, deactivated: false });
  });
});
