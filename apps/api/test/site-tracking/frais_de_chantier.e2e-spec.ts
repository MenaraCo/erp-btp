import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Un chantier ne vit pas que du déboursé direct : le devis a aussi prévu des frais généraux et
 * des frais annexes (installation, compte prorata, nettoyage…). Sans eux, le budget de chantier
 * démarre amputé et la marge se dégrade sans qu'on sache pourquoi. L'acceptation doit donc les
 * reprendre, poste par poste, dans le budget « frais de chantier ».
 */
describe('Suivi de chantier — reprise des frais de chantier (FG + frais annexes)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let ouvrageId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get' ? request(server).get(path)
        : method === 'put' ? request(server).put(path)
          : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  /** Devis : 1 ouvrage matériaux (déboursé 100 × 10 = 1 000) + FG 10 % + frais annexes. */
  async function acceptDevis(
    code: string,
    frais: { designation: string; type: string; valeur: string; mode: string }[] = [],
  ) {
    const created = (await as('post', '/affaires').send({ code, name: code }).expect(201)).body;
    const vId = created.version.id;
    await as('post', `/versions/${vId}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouvrageId, quantity: '10' })
      .expect(201);
    if (frais.length > 0) {
      await as('put', `/versions/${vId}/frais-annexes`).send({ frais }).expect(200);
    }
    await as('put', `/versions/${vId}/sale-sheet`)
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
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    return (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
  }

  function budget(tree: { marches: { lines: { designation: string; vendable: boolean; budget: Record<string, string> }[] }[] }) {
    return tree.marches.flatMap((m) => m.lines);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Frais', 'admin', [
      'estimating',
      'site_tracking',
      'invoicing',
      'financial_management',
    ]));
    const lib = (await as('post', '/libraries').send({ code: 'LF', name: 'LF' }).expect(201)).body;
    const r = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'RF', label: 'RF', unit: 'u', nature: 'material', unitCost: '100' })
        .expect(201)
    ).body;
    const o = (
      await as('post', `/libraries/${lib.id}/ouvrages`).send({ code: 'OF', label: 'OF', unit: 'u' }).expect(201)
    ).body;
    await as('post', `/ouvrages/${o.id}/components`)
      .send({ kind: 'resource', childResourceId: r.id, quantity: '1' })
      .expect(201);
    ouvrageId = o.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('reprend les frais généraux du devis dans le budget du chantier', async () => {
    const acc = await acceptDevis('FRC-1');
    const tree = (await as('get', `/chantiers/${acc.chantier.id}/execution-tree`).expect(200)).body;
    const frais = budget(tree).find((l) => l.designation.includes('Frais de chantier'));
    expect(frais).toBeDefined();
    expect(frais!.vendable).toBe(false);
    // déboursé 1 000 × FG 10 % = 100 (le bénéfice de 20 % n'est pas un coût)
    expect(Number(frais!.budget.objectif)).toBe(100);

    const results = (await as('get', `/chantiers/${acc.chantier.id}/results`).expect(200)).body;
    const so = results.byNature.find((n: { nature: string }) => n.nature === 'site_overhead');
    expect(Number(so.budgetObjectif)).toBe(100);
    // Le budget total du chantier = déboursé direct + frais.
    expect(Number(results.totals.budgetObjectif)).toBe(1100);
  });

  it('reprend chaque poste de frais annexes sous son intitulé, noyé comme séparé', async () => {
    const acc = await acceptDevis('FRC-2', [
      { designation: 'Installation de chantier', type: 'fixe', valeur: '300', mode: 'separe' },
      { designation: 'Compte prorata', type: 'fixe', valeur: '200', mode: 'inclus' },
    ]);
    const nomen = (await as('get', `/chantiers/${acc.chantier.id}/nomenclature`).expect(200)).body;
    const labels = nomen.map((n: { label: string }) => n.label);
    expect(labels).toContain('Installation de chantier');
    expect(labels).toContain('Compte prorata'); // noyé dans les PU du devis, mais bien à payer

    const tree = (await as('get', `/chantiers/${acc.chantier.id}/execution-tree`).expect(200)).body;
    const frais = budget(tree).find((l) => l.designation.includes('Frais de chantier'))!;
    // FG 100 + 300 + 200
    expect(Number(frais.budget.objectif)).toBe(600);
  });

  it('n’ajoute aucune ligne de frais quand le devis n’en porte pas', async () => {
    const created = (await as('post', '/affaires').send({ code: 'FRC-3', name: 'FRC-3' }).expect(201)).body;
    await as('post', `/versions/${created.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Lot', sourceOuvrageId: ouvrageId, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${created.version.id}/sale-sheet`)
      .send({
        byNature: {
          labor: { tauxFg: '0', tauxBenefice: '0' },
          material: { tauxFg: '0', tauxBenefice: '30' },
          equipment: { tauxFg: '0', tauxBenefice: '0' },
          subcontract: { tauxFg: '0', tauxBenefice: '0' },
        },
        tvaRate: '0.20',
      })
      .expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${created.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${created.devis.id}/accept`).expect(201)).body;
    const tree = (await as('get', `/chantiers/${acc.chantier.id}/execution-tree`).expect(200)).body;
    expect(budget(tree).some((l) => l.designation.includes('Frais de chantier'))).toBe(false);
  });

  it('les frais ne polluent pas la branche « À ventiler » du tableau analytique', async () => {
    const acc = await acceptDevis('FRC-4', [
      { designation: 'Nettoyage', type: 'fixe', valeur: '150', mode: 'separe' },
    ]);
    const res = (
      await as('get', `/chantiers/${acc.chantier.id}/analytical-results`).expect(200)
    ).body;
    // Les frais ont leur propre branche : ils n'ont rien à faire dans la liste à ventiler.
    expect(Number(res.siteOverhead.metrics.budgetObjectif)).toBe(250); // FG 100 + nettoyage 150
    const aVentilerLabels = res.aVentiler.resources.map((r: { label: string }) => r.label);
    expect(aVentilerLabels).not.toContain('Nettoyage');
  });
});
