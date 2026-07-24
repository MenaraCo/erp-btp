import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Le marché reproduit l'ARBRE du devis (cahier §5.6) : les titres deviennent des postes
 * structurels (montant porté par leurs ouvrages), afin que la situation ait la même structure.
 */
describe('Invoicing — le marché copie l’arbre du devis (titres + ouvrages)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let marcheId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base = method === 'get' ? request(server).get(path)
      : method === 'put' ? request(server).put(path) : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Tr', 'admin', ['estimating', 'site_tracking', 'invoicing']));

    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mo = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'MO', label: 'Maçon', unit: 'h', nature: 'labor', unitCost: '40' }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mo.id, quantity: '2' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'TR-1', name: 'A' }).expect(201)).body;
    const versionId = created.version.id;
    // Un titre "Lot 1" avec 2 ouvrages dessous.
    const titre = (await as('post', `/versions/${versionId}/lines`)
      .send({ type: 'titre', code: 'L1', designation: 'Lot 1' }).expect(201)).body;
    await as('post', `/versions/${versionId}/lines`)
      .send({ type: 'ouvrage', code: '1.1', designation: 'Ouvrage A', sourceOuvrageId: ouv.id, quantity: '10', parentLineId: titre.id }).expect(201);
    await as('post', `/versions/${versionId}/lines`)
      .send({ type: 'ouvrage', code: '1.2', designation: 'Ouvrage B', sourceOuvrageId: ouv.id, quantity: '5', parentLineId: titre.id }).expect(201);
    await as('put', `/versions/${versionId}/sale-sheet`)
      .send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' }).expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    marcheId = acc.marche.id;
    expect(acc.lineCount).toBe(2); // 2 ouvrages facturables
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('le marché contient le titre (structurel) et ses 2 ouvrages rattachés', async () => {
    const { lines } = (await as('get', `/marches/${marcheId}`).expect(200)).body as {
      lines: Array<{ id: string; parent_line_id: string | null; type: string; designation: string; montant_ht: string }>;
    };
    const titre = lines.find((l) => l.type === 'titre');
    const ouvrages = lines.filter((l) => l.type === 'ouvrage');
    expect(titre).toBeTruthy();
    expect(titre!.parent_line_id).toBeNull();
    expect(titre!.montant_ht).toBe('0.00'); // le titre ne porte pas de montant propre
    expect(ouvrages.length).toBe(2);
    // les 2 ouvrages sont rattachés au titre
    expect(ouvrages.every((o) => o.parent_line_id === titre!.id)).toBe(true);
    // montant total = somme des ouvrages (Ouvrage A 10×80=800, B 5×80=400 → PV avec coeff 1 = déboursé)
    const total = ouvrages.reduce((a, o) => a + Number(o.montant_ht), 0);
    expect(total).toBeGreaterThan(0);
  });
});
