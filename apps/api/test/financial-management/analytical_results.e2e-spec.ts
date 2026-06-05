import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

interface Code {
  id: string;
  code: string;
  metrics: Record<string, string>;
}
interface Famille {
  id: string;
  code: string;
  metrics: Record<string, string>;
  codes: Code[];
}
interface Lot {
  id: string;
  familles: Famille[];
}
interface Nature {
  nature: string;
  metrics: Record<string, string>;
  unallocated: Record<string, string>;
  lots: Lot[];
}

describe('Tableau de bord analytique 5 niveaux (§5.8) — imputation au code analytique (C.3)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let codeId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get' ? request(server).get(path)
        : method === 'put' ? request(server).put(path)
          : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  function findCode(tree: Nature[]): { nature: Nature; lot: Lot; fam: Famille; code: Code } {
    const nature = tree.find((n) => n.nature === 'material')!;
    for (const lot of nature.lots) {
      for (const fam of lot.familles) {
        const code = fam.codes.find((c) => c.id === codeId);
        if (code) return { nature, lot, fam, code };
      }
    }
    throw new Error('code introuvable dans l’arbre');
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'AnaRes', 'admin', [
      'estimating',
      'site_tracking',
      'invoicing',
      'financial_management',
    ]));

    // plan : premier code analytique sous Matériaux → lot → famille
    const plan = (await as('get', '/analytical/plan').expect(200)).body;
    const material = plan.find((n: { nature: string }) => n.nature === 'material');
    const fam = material.lots.flatMap((l: { familles: unknown[] }) => l.familles).find((f: { codes: unknown[] }) => f.codes.length > 0);
    codeId = fam.codes[0].id;

    // affaire → chantier (budget non classé → Non réparti)
    const lib = (await as('post', '/libraries').send({ code: 'L', name: 'L' }).expect(201)).body;
    const mat = (await as('post', `/libraries/${lib.id}/resources`).send({ code: 'MAT', label: 'Colle', unit: 'kg', nature: 'material', unitCost: '100' }).expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'O', label: 'O', unit: 'u' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`).send({ kind: 'resource', childResourceId: mat.id, quantity: '1' }).expect(201);
    const created = (await as('post', '/affaires').send({ code: 'AR-1', name: 'A' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`).send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouv.id, quantity: '10' }).expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`).send({ byNature: { labor: '1', material: '1', equipment: '1', subcontract: '1' }, fraisCoefficient: '1', tvaRate: '0.20' }).expect(200);
    for (const to of ['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    chantierId = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body.chantier.id;

    // engagé 950 + réalisé 900 imputés au code analytique
    const ddp = (await as('post', `/chantiers/${chantierId}/purchase-requests`).send({ code: 'DDP' }).expect(201)).body;
    const order = (await as('post', `/purchase-requests/${ddp.id}/convert`).send({ code: 'BC' }).expect(201)).body;
    await as('post', `/purchase-orders/${order.id}/lines`).send({ nature: 'material', designation: 'Colle', quantity: '10', unitPrice: '95', codeAnalytiqueId: codeId }).expect(201);
    await as('post', `/purchase-orders/${order.id}/validate`).expect(201);
    await as('post', `/purchase-orders/${order.id}/delivery-notes`).send({ code: 'BL' }).expect(201);
    await as('post', `/purchase-orders/${order.id}/invoices`).send({ code: 'F1', nature: 'material', amountHt: '900', codeAnalytiqueId: codeId }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('agrège engagé/réalisé jusqu’au code analytique, budget non classé en « Non réparti »', async () => {
    const res = (await as('get', `/chantiers/${chantierId}/analytical-results`).expect(200)).body;
    const { nature, fam, code } = findCode(res.natures);

    // engagé/réalisé imputés au code
    expect(code.metrics.engage).toBe('950');
    expect(code.metrics.realise).toBe('900');
    // remontée famille
    expect(fam.metrics.engage).toBe('950');
    // budget non classé (ressource non rattachée à un code) → Non réparti de la nature
    expect(nature.unallocated.budgetObjectif).toBe('1000');
    expect(nature.metrics.budgetObjectif).toBe('1000');
    expect(nature.metrics.engage).toBe('950');

    // total réconcilié
    expect(res.total.budgetObjectif).toBe('1000');
    expect(res.total.engage).toBe('950');
    expect(res.total.realise).toBe('900');
  });

  it('place un engagé non imputé dans « Non réparti »', async () => {
    const ddp = (await as('post', `/chantiers/${chantierId}/purchase-requests`).send({ code: 'DDP2' }).expect(201)).body;
    const order = (await as('post', `/purchase-requests/${ddp.id}/convert`).send({ code: 'BC2' }).expect(201)).body;
    await as('post', `/purchase-orders/${order.id}/lines`).send({ nature: 'material', designation: 'X', quantity: '1', unitPrice: '200' }).expect(201);
    await as('post', `/purchase-orders/${order.id}/validate`).expect(201);

    const res = (await as('get', `/chantiers/${chantierId}/analytical-results`).expect(200)).body;
    const material: Nature = res.natures.find((n: Nature) => n.nature === 'material');
    expect(material.unallocated.engage).toBe('200');
    expect(material.metrics.engage).toBe('1150'); // code 950 + non réparti 200
  });

  it('range les frais de chantier (site_overhead) dans la branche dédiée', async () => {
    const ddp = (await as('post', `/chantiers/${chantierId}/purchase-requests`).send({ code: 'DDP3' }).expect(201)).body;
    const order = (await as('post', `/purchase-requests/${ddp.id}/convert`).send({ code: 'BC3' }).expect(201)).body;
    await as('post', `/purchase-orders/${order.id}/lines`).send({ nature: 'site_overhead', designation: 'Installation', quantity: '1', unitPrice: '500' }).expect(201);
    await as('post', `/purchase-orders/${order.id}/validate`).expect(201);

    const res = (await as('get', `/chantiers/${chantierId}/analytical-results`).expect(200)).body;
    expect(res.siteOverhead.metrics.engage).toBe('500');
    expect(res.total.engage).toBe('1650'); // 1150 + 500
  });
});
