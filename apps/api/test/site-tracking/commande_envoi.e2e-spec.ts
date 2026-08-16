import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Envoi du bon de commande au fournisseur.
 *
 * La règle la plus importante n'est pas d'envoyer : c'est de ne JAMAIS prétendre avoir envoyé.
 * Sans messagerie configurée (le cas en test), le message est enregistré en attente, la commande
 * ne porte aucune date d'expédition, et l'écran doit pouvoir le dire.
 */
describe('Site-tracking — envoi du bon de commande', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let codeAnalytiqueId: string;
  let supplierId: string;

  function as(method: 'get' | 'post', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  async function commandeValidee(avecFournisseur = true): Promise<string> {
    const bc = (await as('post', `/chantiers/${chantierId}/purchase-orders`)
      .send(avecFournisseur ? { supplierId } : {}).expect(201)).body;
    await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({ nature: 'material', designation: 'Sable', quantity: '2', unitPrice: '100', codeAnalytiqueId })
      .expect(201);
    await as('post', `/purchase-orders/${bc.id}/submit`).expect(201);
    return bc.id;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Envoi', 'admin', ['site_tracking', 'core']));
    chantierId = (await as('post', '/chantiers').send({ name: 'Tour Nord' }).expect(201)).body.id;
    supplierId = (await as('post', '/suppliers')
      .send({ name: 'Point P', email: 'commandes@pointp.test' }).expect(201)).body.id;

    const lotId = (await as('post', '/params/lots').send({ code: 'GO', label: 'Gros œuvre' }).expect(201)).body.id;
    const familleId = (await as('post', '/params/familles')
      .send({ lotId, code: 'MAC', label: 'Maçonnerie' }).expect(201)).body.id;
    codeAnalytiqueId = (await as('post', '/params/codes')
      .send({ familleId, code: '280', label: 'Colle' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('nannonce_pas_un_envoi_quand_aucune_messagerie_nest_configuree', async () => {
    const id = await commandeValidee();
    const r = (await as('post', `/purchase-orders/${id}/envoyer`).send({}).expect(201)).body;

    expect(r.statut).toBe('pending');
    expect(r.message).toMatch(/pas parti|configur/i);
    // L'adresse du fournisseur sert de destinataire par défaut.
    expect(r.destinataires).toBe('commandes@pointp.test');

    // Et surtout : la commande ne porte AUCUNE date d'expédition.
    const fiche = (await as('get', `/purchase-orders/${id}`).expect(200)).body;
    expect(fiche.commande.sent_at).toBeNull();
  });

  it('garde_la_trace_du_message_avec_sa_piece_jointe', async () => {
    const id = await commandeValidee();
    await as('post', `/purchase-orders/${id}/envoyer`)
      .send({ copies: 'conducteur@demo.test', sujet: 'Commande urgente' })
      .expect(201);

    const emails = (await as('get', `/purchase-orders/${id}/emails`).expect(200)).body;
    expect(emails).toHaveLength(1);
    expect(emails[0].sujet).toBe('Commande urgente');
    expect(emails[0].copies).toBe('conducteur@demo.test');
    expect(emails[0].piece_jointe).toMatch(/^BC-.*\.pdf$/);
    expect(emails[0].statut).toBe('pending');
    expect(emails[0].auteur_email).toBeTruthy();

    // Le journal de la commande porte aussi l'opération.
    const journal = (await as('get', `/purchase-orders/${id}/events`).expect(200)).body;
    expect(journal[0].action).toBe('email_pending');
  });

  it('refuse_denvoyer_un_brouillon_ou_sans_adresse', async () => {
    const brouillon = (await as('post', `/chantiers/${chantierId}/purchase-orders`)
      .send({ supplierId }).expect(201)).body;
    await as('post', `/purchase-orders/${brouillon.id}/envoyer`).send({}).expect(409);

    // Fournisseur sans adresse connue et rien de saisi : on le dit au lieu d'envoyer dans le vide.
    const sansAdresse = await commandeValidee(false);
    await as('post', `/purchase-orders/${sansAdresse}/envoyer`).send({}).expect(400);
  });

  it('refuse_une_adresse_manifestement_invalide', async () => {
    const id = await commandeValidee();
    await as('post', `/purchase-orders/${id}/envoyer`)
      .send({ destinataires: 'pas-une-adresse' })
      .expect(400);
  });
});
