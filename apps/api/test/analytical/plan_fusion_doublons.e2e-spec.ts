import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

/**
 * Nettoyage des doublons DÉJÀ en place.
 *
 * La garde à l'écriture empêche d'en créer de nouveaux ; elle ne dit rien de ceux hérités d'un
 * import ou d'une époque sans contrôle. Or un code analytique en double fausse l'agrégation : la
 * même dépense se répartit sur deux lignes, et les totaux par famille ne veulent plus rien dire.
 *
 * Fusionner, c'est réaffecter TOUT ce qui pointait sur le doublon — ressources, commandes,
 * factures, pointages — avant de le supprimer. En oublier un seul laisserait des coûts orphelins.
 */
describe('Plan analytique — fusionner les doublons hérités', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let familleId: string;

  const as = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](path)
      .set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);

  /** Pose un code analytique en contournant la garde — comme le ferait un import ancien. */
  const codeHerite = async (code: string, label: string): Promise<string> =>
    (await runInTenant(ds, tenantId, (em) =>
      em.query(
        `INSERT INTO analytical_code (tenant_id, famille_id, code, label, nature)
         VALUES ($1, $2, $3, $4, 'material') RETURNING id`,
        [tenantId, familleId, code, label],
      ),
    ))[0].id as string;

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Fusion', 'admin', [
      'core', 'estimating', 'site_tracking',
    ]));
    const lot = (await as('post', '/params/lots').send({ code: 'FIN', label: 'Finitions' }).expect(201)).body;
    familleId = (await as('post', '/params/familles')
      .send({ lotId: lot.id, code: 'COL', label: 'Collage' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('repère deux entrées qui désignent la même chose', async () => {
    await codeHerite('280', 'Colle');
    await codeHerite('281', 'COLLE');

    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    const g = groupes.find((x: { type: string; libelle: string }) => x.type === 'code' && x.libelle === 'colle');
    expect(g).toBeDefined();
    expect(g.entrees.map((e: { code: string }) => e.code).sort()).toEqual(['280', '281']);
  });

  it("compte les usages, pour savoir lequel garder", async () => {
    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    const g = groupes.find((x: { libelle: string }) => x.libelle === 'colle');
    // Aucun des deux n'est encore utilisé : le relevé doit le dire plutôt que de le taire.
    expect(g.entrees.every((e: { usages: number }) => e.usages === 0)).toBe(true);
  });

  it('réaffecte tout ce qui pointait sur le doublon, puis le supprime', async () => {
    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    const g = groupes.find((x: { libelle: string }) => x.libelle === 'colle');
    const garde = g.entrees.find((e: { code: string }) => e.code === '280');
    const supprime = g.entrees.find((e: { code: string }) => e.code === '281');

    // Une ressource de bibliothèque rattachée au doublon — le cas le plus courant.
    const lib = (await as('post', '/libraries').send({ code: 'L-FUS', name: 'L' }).expect(201)).body;
    const res = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'COL1', label: 'Colle C2', unit: 'KG', nature: 'material', unitCost: '3' })
      .expect(201)).body;
    await runInTenant(ds, tenantId, (em) =>
      em.query(`UPDATE resource SET code_analytique_id = $1 WHERE id = $2`, [supprime.id, res.id]));

    const r = (await as('post', '/params/doublons/fusionner')
      .send({ type: 'code', gardeId: garde.id, supprimeId: supprime.id }).expect(201)).body;
    expect(r.reaffectes).toBe(1);

    // La ressource pointe désormais sur le survivant…
    const [apres] = await runInTenant(ds, tenantId, (em) =>
      em.query(`SELECT code_analytique_id FROM resource WHERE id = $1`, [res.id]));
    expect(apres.code_analytique_id).toBe(garde.id);

    // …et le doublon a disparu.
    const restants = await runInTenant(ds, tenantId, (em) =>
      em.query(`SELECT code FROM analytical_code WHERE id = ANY($1)`, [[garde.id, supprime.id]]));
    expect(restants.map((x: { code: string }) => x.code)).toEqual(['280']);
  });

  it('le doublon disparaît du relevé une fois fusionné', async () => {
    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    expect(groupes.find((x: { libelle: string }) => x.libelle === 'colle')).toBeUndefined();
  });

  it('refuse de fusionner une entrée avec elle-même, ou un type inconnu', async () => {
    const lot = (await as('post', '/params/lots').send({ code: 'X1', label: 'Divers' }).expect(201)).body;
    await as('post', '/params/doublons/fusionner')
      .send({ type: 'lot', gardeId: lot.id, supprimeId: lot.id }).expect(400);
    await as('post', '/params/doublons/fusionner')
      .send({ type: 'inconnu', gardeId: lot.id, supprimeId: lot.id }).expect(400);
  });
});
