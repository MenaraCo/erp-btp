import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { createUser } from '../support/entitlements.helpers';
import { EntitlementsService } from '../../src/core/entitlements/entitlements.service';
import { RbacService } from '../../src/core/rbac/rbac.service';

/**
 * Gouvernance du référentiel — proposer n'est pas valider.
 *
 * Le conducteur enregistre un fournisseur découvert sur le chantier sans attendre ; la fiche entre
 * « à valider ». QUI la régularise n'est pas figé : c'est la permission `directory.validate`, que
 * l'administrateur pose sur le rôle de son choix (ici un rôle satellite cumulé à un autre).
 */
describe('Référentiel — proposer, valider, et refuser les doublons', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let deviseur: string;
  let conducteur: string;
  /** Une secrétaire : aucun droit métier, mais le rôle satellite de validation. */
  let valideur: string;

  const MODULES = ['core', 'estimating', 'site_tracking'];

  const as = (method: 'get' | 'post' | 'patch', path: string, userId: string) =>
    request(app.getHttpServer())[method](path)
      .set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);

  async function membre(email: string, roles: string[]): Promise<string> {
    const id = await createUser(ds, tenantId, email);
    for (const m of MODULES) await app.get(EntitlementsService).assignSeat(tenantId, m, id);
    for (const r of roles) await app.get(RbacService).assignRole(tenantId, id, r);
    return id;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId: deviseur } = await entitleUser(app, ds, 'Ref', 'estimator', MODULES));
    conducteur = await membre('conducteur@ref.test', ['conducteur']);
    // Rôle satellite SEUL : elle ne peut rien faire d'autre que valider.
    valideur = await membre('secretaire@ref.test', ['referentiel_valideur']);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('le deviseur tient le référentiel : sa fiche naît validée', async () => {
    const r = await as('post', '/suppliers', deviseur)
      .send({ code: 'SUP-A', name: 'Matériaux du Nord' }).expect(201);
    expect(r.body.statut).toBe('valide');
  });

  it("le conducteur propose : la fiche naît « à valider » et porte son auteur", async () => {
    const r = await as('post', '/suppliers/proposer', conducteur)
      .send({ code: 'SUP-B', name: 'Loueur de bennes' }).expect(201);
    expect(r.body.statut).toBe('a_valider');
    expect(r.body.proposedBy).toBe(conducteur);

    // Utilisable IMMÉDIATEMENT : elle figure dans le référentiel, le chantier n'attend pas.
    const liste = await as('get', '/suppliers?pageSize=100', conducteur).expect(200);
    expect(liste.body.rows.some((s: { code: string }) => s.code === 'SUP-B')).toBe(true);
  });

  it("le conducteur ne peut pas passer par la porte des propriétaires du référentiel (403)", async () => {
    await as('post', '/suppliers', conducteur)
      .send({ code: 'SUP-C', name: 'Interdit' }).expect(403);
  });

  it("le conducteur ne valide pas sa propre proposition (403)", async () => {
    const p = await as('post', '/suppliers/proposer', conducteur)
      .send({ code: 'SUP-D', name: 'Négoce Bois' }).expect(201);
    await as('post', `/suppliers/${p.body.id}/valider`, conducteur).expect(403);
  });

  it('la file d’attente ne montre que les fiches proposées', async () => {
    const file = await as('get', '/suppliers/a-valider', deviseur).expect(200);
    const codes = file.body.map((s: { code: string }) => s.code);
    expect(codes).toContain('SUP-B');
    expect(codes).not.toContain('SUP-A'); // créée validée
  });

  it("n'importe quel rôle porteur de directory.validate régularise — ici la secrétaire", async () => {
    const p = await as('post', '/suppliers/proposer', conducteur)
      .send({ code: 'SUP-E', name: 'Échafaudages Rapides' }).expect(201);
    const v = await as('post', `/suppliers/${p.body.id}/valider`, valideur).expect(201);
    expect(v.body.statut).toBe('valide');
    expect(v.body.validatedBy).toBe(valideur);
    // Une fiche déjà validée ne se revalide pas.
    await as('post', `/suppliers/${p.body.id}/valider`, valideur).expect(409);
  });

  describe('doublons refusés', () => {
    it('refuse un code déjà pris', async () => {
      await as('post', '/suppliers', deviseur)
        .send({ code: 'SUP-A', name: 'Autre entreprise' }).expect(409);
    });

    it('refuse la même entreprise écrite autrement', async () => {
      await as('post', '/suppliers', deviseur)
        .send({ code: 'MDN2', name: 'MATERIAUX DU NORD SARL' }).expect(409);
    });

    it('refuse aussi par la voie du terrain — la règle ne dépend pas de la porte', async () => {
      const r = await as('post', '/suppliers/proposer', conducteur)
        .send({ code: 'MDN3', name: 'Matériaux du Nord' }).expect(409);
      expect(r.body.message).toContain('Matériaux du Nord');
    });

    it('laisse passer une entreprise réellement nouvelle', async () => {
      await as('post', '/suppliers', deviseur)
        .send({ code: 'SUP-Z', name: 'Carrelages Provence' }).expect(201);
    });
  });

  it('le client reste réservé à ceux qui tiennent le référentiel', async () => {
    await as('post', '/clients', deviseur).send({ code: 'CLI-1', name: 'Ville de Lyon' }).expect(201);
    // Le conducteur n'a aucune voie de proposition côté client : c'est la règle voulue.
    await as('post', '/clients', conducteur).send({ code: 'CLI-2', name: 'Interdit' }).expect(403);
  });
});
