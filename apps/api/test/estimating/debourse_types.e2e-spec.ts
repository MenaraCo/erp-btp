import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Types de déboursé paramétrables : l'entreprise définit ses propres postes (« ST Moyens »,
 * « Location », « Intérim »…) avec leur code et leur intitulé, chacun rattaché à l'une des quatre
 * natures de base — c'est cette nature qui alimente ensuite les budgets de chantier et l'axe
 * analytique. Un devis peut créer un type pour lui seul, puis le remonter au référentiel.
 */
describe('Études de prix — référentiel des types de déboursé', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post' | 'put' | 'delete', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get' ? request(server).get(path)
        : method === 'put' ? request(server).put(path)
          : method === 'delete' ? request(server).delete(path)
            : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  async function newVersion(code: string): Promise<string> {
    const created = (await as('post', '/affaires').send({ code, name: code }).expect(201)).body;
    return created.version.id as string;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'DebType', 'admin', 'estimating'));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('fournit d’office les quatre types de base, rattachés aux bonnes natures', async () => {
    const types = (await as('get', '/debourse-types').expect(200)).body;
    expect(types.map((t: { code: string }) => t.code)).toEqual(['MO', 'M', 'MAT', 'ST']);
    const byCode = Object.fromEntries(types.map((t: { code: string }) => [t.code, t]));
    expect(byCode.MO.baseNature).toBe('labor');
    expect(byCode.M.baseNature).toBe('material');
    expect(byCode.MAT.baseNature).toBe('equipment');
    expect(byCode.ST.baseNature).toBe('subcontract');
    expect(byCode.MO.builtin).toBe(true);
  });

  it('ajoute un type société, et refuse (409) un code déjà pris', async () => {
    const created = (
      await as('post', '/debourse-types')
        .send({ code: 'STM', label: 'ST Moyens', baseNature: 'subcontract' })
        .expect(201)
    ).body;
    expect(created.label).toBe('ST Moyens');
    expect(created.devisVersionId).toBeNull();

    await as('post', '/debourse-types')
      .send({ code: 'STM', label: 'Doublon', baseNature: 'subcontract' })
      .expect(409);
  });

  it('renomme un type — y compris un type de base — et change son rattachement', async () => {
    const types = (await as('get', '/debourse-types').expect(200)).body;
    const mat = types.find((t: { code: string }) => t.code === 'MAT');
    const updated = (
      await as('put', `/debourse-types/${mat.id}`)
        .send({ code: 'LOC', label: 'Location de matériel' })
        .expect(200)
    ).body;
    expect(updated.code).toBe('LOC');
    expect(updated.label).toBe('Location de matériel');
    expect(updated.baseNature).toBe('equipment'); // inchangé faute d'être fourni
  });

  it('supprime un type', async () => {
    const created = (
      await as('post', '/debourse-types')
        .send({ code: 'TMP', label: 'À jeter', baseNature: 'labor' })
        .expect(201)
    ).body;
    await as('delete', `/debourse-types/${created.id}`).expect(200);
    const codes = (await as('get', '/debourse-types').expect(200)).body.map(
      (t: { code: string }) => t.code,
    );
    expect(codes).not.toContain('TMP');
  });

  it('un type créé pour un devis ne sort pas de ce devis, et peut être promu au référentiel', async () => {
    const v1 = await newVersion('DT-1');
    const v2 = await newVersion('DT-2');
    const local = (
      await as('post', '/debourse-types')
        .send({ code: 'INT', label: 'Intérim', baseNature: 'labor', devisVersionId: v1 })
        .expect(201)
    ).body;
    expect(local.devisVersionId).toBe(v1);

    const forV1 = (await as('get', `/debourse-types?devisVersionId=${v1}`).expect(200)).body;
    const forV2 = (await as('get', `/debourse-types?devisVersionId=${v2}`).expect(200)).body;
    const societe = (await as('get', '/debourse-types').expect(200)).body;
    expect(forV1.map((t: { code: string }) => t.code)).toContain('INT');
    expect(forV2.map((t: { code: string }) => t.code)).not.toContain('INT');
    expect(societe.map((t: { code: string }) => t.code)).not.toContain('INT');

    await as('post', `/debourse-types/${local.id}/promote`).expect(201);
    const apres = (await as('get', '/debourse-types').expect(200)).body;
    expect(apres.map((t: { code: string }) => t.code)).toContain('INT');
    // Désormais disponible pour tous les devis, celui d'origine comme les autres.
    const v2Apres = (await as('get', `/debourse-types?devisVersionId=${v2}`).expect(200)).body;
    expect(v2Apres.map((t: { code: string }) => t.code)).toContain('INT');
  });

  it('deux devis peuvent porter le même code local sans se gêner', async () => {
    const v1 = await newVersion('DT-3');
    const v2 = await newVersion('DT-4');
    await as('post', '/debourse-types')
      .send({ code: 'SPE', label: 'Spécifique A', baseNature: 'material', devisVersionId: v1 })
      .expect(201);
    await as('post', '/debourse-types')
      .send({ code: 'SPE', label: 'Spécifique B', baseNature: 'material', devisVersionId: v2 })
      .expect(201);
    const forV2 = (await as('get', `/debourse-types?devisVersionId=${v2}`).expect(200)).body;
    expect(forV2.find((t: { code: string }) => t.code === 'SPE').label).toBe('Spécifique B');
  });

  it('refuse une nature de rattachement inconnue (400)', async () => {
    await as('post', '/debourse-types')
      .send({ code: 'BAD', label: 'Mauvaise nature', baseNature: 'site_overhead' })
      .expect(400);
  });
});
