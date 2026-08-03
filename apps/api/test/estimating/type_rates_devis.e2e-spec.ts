import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * La feuille de vente travaille désormais sur les TYPES DE DÉBOURSÉ de l'entreprise : chaque type
 * porte ses propres % FG et % bénéfice sur ce devis. Les quatre natures de base restent le socle
 * de la gestion en aval — elles se déduisent du type qui porte chaque nature.
 */
describe('Études de prix — taux par type de déboursé sur le devis', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get' ? request(server).get(path)
        : method === 'put' ? request(server).put(path)
          : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  async function newVersion(code: string): Promise<string> {
    return (await as('post', '/affaires').send({ code, name: code }).expect(201)).body.version.id;
  }

  /** Une ressource autonome d'une nature donnée, au déboursé voulu. */
  async function addResource(versionId: string, nature: string, pu: string, qty = '1') {
    const titre = (
      await as('post', `/versions/${versionId}/lines`)
        .send({ type: 'titre', code: '1', designation: 'T', sortOrder: 1 })
        .expect(201)
    ).body;
    return (
      await as('post', `/versions/${versionId}/lines`)
        .send({
          type: 'ressource', parentLineId: titre.id, code: 'R', designation: 'R',
          unit: 'u', quantity: qty, pu, nature,
        })
        .expect(201)
    ).body;
  }

  async function types(versionId: string) {
    const sheet = (await as('get', `/versions/${versionId}/sale-sheet/config`).expect(200)).body;
    return sheet.types as Array<{
      id: string; code: string; baseNature: string; tauxFg: string; tauxBenefice: string;
    }>;
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'TypeRates', 'admin', 'estimating'));
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('la feuille de vente propose les types de l’entreprise, taux à zéro au départ', async () => {
    const v = await newVersion('TR-1');
    const list = await types(v);
    expect(list.map((t) => t.code)).toEqual(['MO', 'M', 'MAT', 'ST']);
    expect(list.every((t) => t.tauxFg === '0')).toBe(true);
  });

  it('enregistre les taux par type et en déduit ceux des natures de base', async () => {
    const v = await newVersion('TR-2');
    const list = await types(v);
    const byCode = Object.fromEntries(list.map((t) => [t.code, t]));
    await as('put', `/versions/${v}/sale-sheet`)
      .send({
        types: [
          { typeId: byCode.MO.id, tauxFg: '12', tauxBenefice: '15' },
          { typeId: byCode.M.id, tauxFg: '8', tauxBenefice: '10' },
        ],
        tvaRate: '0.20',
      })
      .expect(200);

    const sheet = (await as('get', `/versions/${v}/sale-sheet/config`).expect(200)).body;
    const relu = Object.fromEntries(
      sheet.types.map((t: { code: string; tauxFg: string }) => [t.code, t.tauxFg]),
    );
    expect(relu.MO).toBe('12');
    expect(relu.M).toBe('8');
    // Les natures de base suivent le type qui les porte : la chaîne budgets/analytique reste alimentée.
    expect(sheet.byNature.labor.tauxFg).toBe('12');
    expect(sheet.byNature.material.tauxBenefice).toBe('10');
  });

  it('un type ajouté pour ce devis porte ses propres taux dans le calcul', async () => {
    const v = await newVersion('TR-3');
    const loc = (
      await as('post', '/debourse-types')
        .send({ code: 'LOC', label: 'Location', baseNature: 'equipment', devisVersionId: v })
        .expect(201)
    ).body;
    const list = await types(v);
    expect(list.map((t) => t.code)).toContain('LOC');

    const mat = list.find((t) => t.code === 'MAT')!;
    await as('put', `/versions/${v}/sale-sheet`)
      .send({
        types: [
          { typeId: mat.id, tauxFg: '5', tauxBenefice: '5' },
          { typeId: loc.id, tauxFg: '20', tauxBenefice: '30' },
        ],
        tvaRate: '0.20',
      })
      .expect(200);

    const relu = (await types(v)).find((t) => t.code === 'LOC')!;
    expect(relu.tauxFg).toBe('20');
    expect(relu.tauxBenefice).toBe('30');
    expect(relu.baseNature).toBe('equipment');
  });

  it('un devis chiffré AVANT les types retrouve ses taux, par nature de rattachement', async () => {
    const v = await newVersion('TR-5');
    await as('put', `/versions/${v}/sale-sheet`)
      .send({
        byNature: {
          labor: { tauxFg: '12', tauxBenefice: '15' },
          material: { tauxFg: '8', tauxBenefice: '10' },
          equipment: { tauxFg: '0', tauxBenefice: '0' },
          subcontract: { tauxFg: '5', tauxBenefice: '5' },
        },
        tvaRate: '0.20',
      })
      .expect(200);
    // Aucun taux par type n'a été enregistré : chaque type doit hériter de sa nature, sinon
    // le simple fait d'ouvrir puis d'enregistrer la feuille remettrait le devis à zéro.
    const relu = Object.fromEntries((await types(v)).map((t) => [t.code, t]));
    expect(relu.MO.tauxFg).toBe('12');
    expect(relu.MO.tauxBenefice).toBe('15');
    expect(relu.M.tauxFg).toBe('8');
    expect(relu.ST.tauxBenefice).toBe('5');
  });

  it('une ressource rattachée à un type suit LES COEFFICIENTS DE CE TYPE', async () => {
    const v = await newVersion('TR-6');
    const loc = (
      await as('post', '/debourse-types')
        .send({ code: 'LOC2', label: 'Location', baseNature: 'equipment', devisVersionId: v })
        .expect(201)
    ).body;
    const list = await types(v);
    const mat = list.find((t) => t.code === 'MAT')!;

    // Deux ressources « matériel » : l'une sur le type de base, l'autre sur « Location ».
    const titre = (
      await as('post', `/versions/${v}/lines`)
        .send({ type: 'titre', code: '1', designation: 'T', sortOrder: 1 })
        .expect(201)
    ).body;
    const base = (
      await as('post', `/versions/${v}/lines`)
        .send({
          type: 'ressource', parentLineId: titre.id, code: 'A', designation: 'Matériel courant',
          unit: 'u', quantity: '1', pu: '1000', nature: 'equipment', debourseTypeId: mat.id,
        })
        .expect(201)
    ).body;
    const louee = (
      await as('post', `/versions/${v}/lines`)
        .send({
          type: 'ressource', parentLineId: titre.id, code: 'B', designation: 'Nacelle louée',
          unit: 'u', quantity: '1', pu: '1000', nature: 'equipment', debourseTypeId: loc.id,
        })
        .expect(201)
    ).body;

    await as('put', `/versions/${v}/sale-sheet`)
      .send({
        types: [
          { typeId: mat.id, tauxFg: '10', tauxBenefice: '0' }, // 1000 → 1100
          { typeId: loc.id, tauxFg: '50', tauxBenefice: '0' }, // 1000 → 1500
        ],
        tvaRate: '0.20',
      })
      .expect(200);

    const fv = (await as('get', `/versions/${v}/sale-sheet`).expect(200)).body;
    const byId = Object.fromEntries(fv.items.map((i: { id: string }) => [i.id, i]));
    expect(byId[base.id].revient).toBe('1100');
    expect(byId[louee.id].revient).toBe('1500'); // et non 1100 : le type l'emporte sur la nature
    // Les deux restent du « matériel » pour les budgets de chantier et l'analytique.
    expect(byId[louee.id].debourseByNature.equipment).toBe('1000');
    expect(fv.totalRevient).toBe('2600');
  });

  it('une ressource de bibliothèque transmet son type à la ligne de devis', async () => {
    const v = await newVersion('TR-7');
    const loc = (
      await as('post', '/debourse-types')
        .send({ code: 'LOC3', label: 'Location', baseNature: 'equipment' })
        .expect(201)
    ).body;
    const lib = (await as('post', '/libraries').send({ code: 'LTR', name: 'LTR' }).expect(201)).body;
    const res = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({
          code: 'NACELLE', label: 'Nacelle', unit: 'j', nature: 'equipment',
          unitCost: '1000', debourseTypeId: loc.id,
        })
        .expect(201)
    ).body;
    expect(res.debourseTypeId).toBe(loc.id);

    const titre = (
      await as('post', `/versions/${v}/lines`)
        .send({ type: 'titre', code: '1', designation: 'T', sortOrder: 1 })
        .expect(201)
    ).body;
    // Ajoutée depuis la bibliothèque SANS préciser de type : elle doit hériter de celui de la ressource.
    const ligne = (
      await as('post', `/versions/${v}/lines`)
        .send({
          type: 'ressource', parentLineId: titre.id, sourceResourceId: res.id,
          designation: 'Nacelle', quantity: '1',
        })
        .expect(201)
    ).body;
    expect(ligne.debourse_type_id).toBe(loc.id);

    const mat = (await types(v)).find((t) => t.code === 'MAT')!;
    await as('put', `/versions/${v}/sale-sheet`)
      .send({
        types: [
          { typeId: mat.id, tauxFg: '0', tauxBenefice: '0' },
          { typeId: loc.id, tauxFg: '40', tauxBenefice: '0' },
        ],
        tvaRate: '0.20',
      })
      .expect(200);
    const fv = (await as('get', `/versions/${v}/sale-sheet`).expect(200)).body;
    expect(fv.totalRevient).toBe('1400'); // les taux du type « Location », pas ceux du matériel
  });

  it('les devis déjà chiffrés en byNature continuent de fonctionner à l’identique', async () => {
    const v = await newVersion('TR-4');
    await addResource(v, 'material', '1000');
    await as('put', `/versions/${v}/sale-sheet`)
      .send({
        byNature: {
          labor: { tauxFg: '0', tauxBenefice: '0' },
          material: { tauxFg: '10', tauxBenefice: '20' },
          equipment: { tauxFg: '0', tauxBenefice: '0' },
          subcontract: { tauxFg: '0', tauxBenefice: '0' },
        },
        tvaRate: '0.20',
      })
      .expect(200);
    const fv = (await as('get', `/versions/${v}/sale-sheet`).expect(200)).body;
    expect(fv.totalRevient).toBe('1100');
    expect(fv.totalPvHt).toBe('1320');
  });
});
