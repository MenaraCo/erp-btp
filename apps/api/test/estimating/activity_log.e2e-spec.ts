import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';
import { TenantContext } from '../../src/core/tenancy/tenant-context';
import { ActivityService } from '../../src/core/activity/activity.service';

interface FilEvent {
  entityType: string;
  entityId: string | null;
  action: string;
  label: string;
  detail: Record<string, unknown> | null;
  actorEmail: string | null;
  createdAt: string;
}

describe("Historique des modifications — le fil daté et signé de l'application", () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post' | 'patch' | 'put', path: string) {
    const server = app.getHttpServer();
    const base = request(server)[method](path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  const fil = async (limit = 20): Promise<FilEvent[]> =>
    (await as('get', `/activity?limit=${limit}`).expect(200)).body;

  /** Compte brut en base : le fil filtré par l'API ne doit pas masquer une ligne qui traînerait. */
  const compterLignes = (): Promise<number> =>
    runInTenant(ds, tenantId, async (em) => {
      const [row] = await em.query(`SELECT COUNT(*)::int AS n FROM activity_log`);
      return row.n as number;
    });

  async function newAffaire(code: string) {
    return (await as('post', '/affaires').send({ code, name: `Affaire ${code}` }).expect(201)).body;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Fil', 'admin', ['estimating', 'invoicing']));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it("journalise un changement de statut avec son auteur, son avant et son après", async () => {
    const { affaire, devis } = await newAffaire('FIL-1');
    await as('post', `/devis/${devis.id}/transition`).send({ to: 'sent' }).expect(201);
    await as('post', `/devis/${devis.id}/transition`).send({ to: 'won' }).expect(201);

    const events = await fil();
    const statut = events.find((e) => e.action === 'statut' && e.label.includes('Gagné'));
    expect(statut).toBeDefined();
    // La phrase est celle qui s'affiche : « DEV-… → Gagné (Affaire FIL-1) ».
    expect(statut!.label).toContain(devis.numero);
    expect(statut!.label).toContain(affaire.name);
    expect(statut!.detail).toEqual({ de: 'sent', vers: 'won' });
    expect(statut!.entityType).toBe('devis');
    expect(statut!.entityId).toBe(devis.id);
    // Signé : l'auteur vient du contexte de la requête, pas d'un paramètre du client.
    expect(statut!.actorEmail).toMatch(/@/);
  });

  it('journalise la création et la modification des affaires et des devis', async () => {
    const { affaire } = await newAffaire('FIL-2');
    await as('patch', `/affaires/${affaire.id}`).send({ name: 'Affaire renommée' }).expect(200);
    await as('post', `/affaires/${affaire.id}/devis`)
      .send({ designation: 'Lot 2 — Peinture' })
      .expect(201);

    const events = await fil(50);
    expect(
      events.some((e) => e.action === 'creation' && e.entityType === 'affaire' && e.label.includes('FIL-2')),
    ).toBe(true);
    expect(
      events.some((e) => e.action === 'modification' && e.label.includes('Affaire renommée')),
    ).toBe(true);
    expect(
      events.some((e) => e.action === 'creation' && e.entityType === 'devis'),
    ).toBe(true);
  });

  /**
   * Les boutons d'action rapide de la liste des devis passent par `PUT /devis/:id/status`, pas par
   * la machine à états. Deux chemins pour un même geste : le fil doit entendre les deux, sinon il
   * manquerait la voie la plus empruntée de l'application.
   */
  it("journalise aussi le statut posé par l'action rapide de la liste", async () => {
    const { devis } = await newAffaire('FIL-5');
    await as('put', `/devis/${devis.id}/status`).send({ status: 'sent' }).expect(200);

    const events = await fil(50);
    const statut = events.find((e) => e.action === 'statut' && e.entityId === devis.id);
    expect(statut).toBeDefined();
    expect(statut!.label).toContain('Envoyé');
    expect(statut!.detail).toEqual({ de: 'open', vers: 'sent' });

    // Reposer le MÊME statut ne raconte rien : le fil ne doit pas se remplir de faux mouvements.
    const avant = await compterLignes();
    await as('put', `/devis/${devis.id}/status`).send({ status: 'sent' }).expect(200);
    expect(await compterLignes()).toBe(avant);
  });

  it('journalise la duplication comme la création de devis qu’elle est', async () => {
    const { devis } = await newAffaire('FIL-6');
    await as('post', `/devis/${devis.id}/duplicate`).expect(201);
    const events = await fil(50);
    expect(
      events.some((e) => e.action === 'creation' && e.entityType === 'devis' && e.label.includes('(copie)')),
    ).toBe(true);
  });

  /** L'acceptation vient d'un AUTRE module (facturation) : le fil doit l'entendre aussi. */
  it("journalise l'acceptation de commande", async () => {
    const lib = (await as('post', '/libraries').send({ code: 'L-FIL7', name: 'L' }).expect(201)).body;
    const mat = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'MAT-FIL7', label: 'Mat', unit: 'u', nature: 'material', unitCost: '200' })
        .expect(201)
    ).body;
    const ouv = (
      await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)
    ).body;
    await as('post', `/ouvrages/${ouv.id}/components`)
      .send({ kind: 'resource', childResourceId: mat.id, quantity: '1' })
      .expect(201);

    const { devis, version } = await newAffaire('FIL-7');
    await as('post', `/versions/${version.id}/lines`)
      .send({ type: 'ouvrage', designation: 'Ligne', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${devis.id}/transition`).send({ to }).expect(201);
    }
    await as('post', `/devis/${devis.id}/accept`).expect(201);

    const events = await fil(50);
    const acceptation = events.find((e) => e.action === 'acceptation');
    expect(acceptation).toBeDefined();
    expect(acceptation!.entityType).toBe('marche');
    expect(acceptation!.label).toContain('Commande acceptée');
    expect(acceptation!.label).toContain('FIL-7');
    expect(acceptation!.actorEmail).toMatch(/@/);
  });

  it('rend le fil du plus récent au plus ancien, et respecte la limite demandée', async () => {
    await newAffaire('FIL-3');
    const events = await fil(2);
    expect(events).toHaveLength(2);
    const dates = events.map((e) => e.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  /**
   * LA règle du fil : `log` écrit dans la transaction de l'opération qu'il relate. Si cette
   * opération se retire, la trace se retire avec elle — un fil qui annoncerait un fait annulé
   * serait pire que pas de fil du tout.
   */
  it("ne laisse AUCUNE trace quand l'opération qui l'entoure échoue", async () => {
    const avant = await compterLignes();

    await expect(
      app.get(TenantContext).run({ tenantId, userId }, () =>
        runInTenant(ds, tenantId, async (em) => {
          await app.get(ActivityService).log(em, {
            entityType: 'devis',
            entityId: null,
            action: 'statut',
            label: 'Événement qui ne doit jamais survivre',
          });
          // L'opération métier échoue APRÈS la journalisation : c'est le seul cas qui distingue
          // une transaction commune d'une écriture autonome.
          throw new Error('échec simulé après journalisation');
        }),
      ),
    ).rejects.toThrow('échec simulé après journalisation');

    expect(await compterLignes()).toBe(avant);
    const events = await fil(50);
    expect(events.some((e) => e.label.includes('ne doit jamais survivre'))).toBe(false);
  });

  it("n'enregistre rien lorsqu'une transition est refusée par la machine à états", async () => {
    const { devis } = await newAffaire('FIL-4');
    const avant = await compterLignes();
    // Un devis « En cours » n'a jamais été envoyé : on ne peut pas le « Relancer ».
    await as('post', `/devis/${devis.id}/transition`).send({ to: 'followup' }).expect(409);
    expect(await compterLignes()).toBe(avant);
  });

  it('gating : sans la capacité estimating, refus (403)', async () => {
    const autre = await entitleUser(app, ds, 'Fil2', 'admin', ['site_tracking']);
    await request(app.getHttpServer())
      .get('/activity')
      .set('Host', 'localhost')
      .set('X-Tenant-Id', autre.tenantId)
      .set('X-User-Id', autre.userId)
      .expect(403);
  });
});
