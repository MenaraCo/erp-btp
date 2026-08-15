import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Couleur de chantier : elle sert de repère visuel dans tous les calendriers. Deux exigences —
 * chaque chantier en reçoit une à la création (sinon la légende naît vide), et on peut la changer
 * sans jamais laisser passer une valeur qui ne soit pas une couleur.
 */
describe('Chantier — couleur de repérage', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post' | 'patch', path: string) {
    const server = app.getHttpServer();
    const r = method === 'get' ? request(server).get(path)
      : method === 'post' ? request(server).post(path)
        : request(server).patch(path);
    return r.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'ChCouleur', 'admin', ['site_tracking']));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('attribue_une_couleur_a_la_creation_et_change_de_teinte_dun_chantier_a_lautre', async () => {
    const un = (await as('post', '/chantiers').send({ code: 'COL-1', name: 'Un' }).expect(201)).body;
    const deux = (await as('post', '/chantiers').send({ code: 'COL-2', name: 'Deux' }).expect(201)).body;

    expect(un.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(deux.color).toMatch(/^#[0-9a-f]{6}$/i);
    // Deux chantiers créés à la suite ne doivent pas se confondre dans le calendrier.
    expect(deux.color).not.toBe(un.color);
  });

  it('accepte_une_couleur_choisie_et_refuse_toute_valeur_qui_nen_est_pas_une', async () => {
    const ch = (await as('post', '/chantiers').send({ code: 'COL-3', name: 'Trois' }).expect(201)).body;

    const modifie = (await as('patch', `/chantiers/${ch.id}/couleur`)
      .send({ color: '#0f766e' }).expect(200)).body;
    expect(modifie.color).toBe('#0f766e');

    await as('patch', `/chantiers/${ch.id}/couleur`).send({ color: 'vert' }).expect(400);
    await as('patch', `/chantiers/${ch.id}/couleur`).send({ color: '#0f766' }).expect(400);
    await as('patch', `/chantiers/${ch.id}/couleur`).send({}).expect(400);

    // Un refus ne doit rien avoir écrasé.
    const liste = (await as('get', '/chantiers').expect(200)).body;
    expect(liste.find((c: { id: string }) => c.id === ch.id).color).toBe('#0f766e');
  });
});
