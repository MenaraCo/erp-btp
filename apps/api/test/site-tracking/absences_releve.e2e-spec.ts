import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Relevé d'absences : filtres et édition PDF.
 *
 * Le relevé sert à répondre à la paye et au salarié — « combien de jours, de quel type ». Un
 * filtre qui laisse passer un motif de trop, ou un PDF vide, se voit à la première contestation.
 */
describe('Gestion du personnel — relevé d’absences', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let paul: string;
  let marie: string;

  function as(method: 'get' | 'post', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Abs', 'admin', ['site_tracking', 'core']));

    paul = (await as('post', '/employees')
      .send({ lastName: 'Durand', firstName: 'Paul', hourlyCost: '20' }).expect(201)).body.id;
    marie = (await as('post', '/employees')
      .send({ lastName: 'Leroy', firstName: 'Marie', hourlyCost: '22' }).expect(201)).body.id;

    // Une semaine de congés pour Paul, deux jours d'intempéries pour tout le monde.
    await as('post', '/personnel/absences')
      .send({ employeeId: paul, kind: 'conges', debut: '2026-07-06', fin: '2026-07-10' })
      .expect(201);
    await as('post', '/personnel/absences')
      .send({ employeeId: paul, kind: 'intemperie', debut: '2026-07-15', fin: '2026-07-16' })
      .expect(201);
    await as('post', '/personnel/absences')
      .send({ employeeId: marie, kind: 'maladie', debut: '2026-07-20', fin: '2026-07-21' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('filtre_par_salarie_et_par_motif_sans_melanger_les_deux', async () => {
    const tout = (await as('get', '/personnel/absences?debut=2026-07-01&fin=2026-07-31').expect(200)).body;
    expect(tout).toHaveLength(9);            // 5 jours ouvrés + 2 + 2

    const congés = (await as('get', '/personnel/absences?debut=2026-07-01&fin=2026-07-31&motif=conges')
      .expect(200)).body;
    expect(congés).toHaveLength(5);
    expect(congés.every((a: { kind: string }) => a.kind === 'conges')).toBe(true);

    const dePaul = (await as('get', `/personnel/absences?debut=2026-07-01&fin=2026-07-31&salarie=${paul}`)
      .expect(200)).body;
    expect(dePaul).toHaveLength(7);

    // Les deux filtres ensemble se cumulent, ils ne se remplacent pas.
    const congesDePaul = (await as(
      'get', `/personnel/absences?debut=2026-07-01&fin=2026-07-31&salarie=${paul}&motif=conges`,
    ).expect(200)).body;
    expect(congesDePaul).toHaveLength(5);
    expect(congesDePaul[0].matricule).toBeTruthy();
  });

  it('edite_un_releve_pdf_qui_porte_le_recapitulatif_de_la_periode', async () => {
    const res = await as('get', '/personnel/absences/export.pdf?debut=2026-07-01&fin=2026-07-31')
      .buffer(true)
      .parse((r, cb) => {
        const morceaux: Buffer[] = [];
        r.on('data', (c: Buffer) => morceaux.push(c));
        r.on('end', () => cb(null, Buffer.concat(morceaux)));
      })
      .expect(200);

    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('refuse_une_periode_mal_formee_plutot_que_de_sortir_un_document_vide', async () => {
    await as('get', '/personnel/absences/export.pdf?debut=juillet&fin=2026-07-31').expect(400);
  });
});
