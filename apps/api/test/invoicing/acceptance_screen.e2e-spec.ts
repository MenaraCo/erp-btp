import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Acceptation de commande — la charnière étude → exécution.
 *
 * L'écran a besoin de trois choses, et ce sont elles qu'on verrouille ici :
 *  - la file « à accepter » (devis gagnés pas encore transformés), au montant de VENTE ;
 *  - la bascule vers « acceptés » une fois le marché et le chantier créés ;
 *  - la fiche d'acceptation, qui présente client, montants et options/variantes du devis,
 *    et permet de choisir celles que la commande retient.
 */
describe('Invoicing — acceptation de commande : file, fiche et options retenues', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let ouvrageId: string;
  let clientId: string;

  function as(method: 'get' | 'post' | 'put', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get'
        ? request(server).get(path)
        : method === 'put'
          ? request(server).put(path)
          : request(server).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  /** Devis à 1 ouvrage de base (déboursé 100 × qty) + éventuellement une section option/variante. */
  async function buildDevis(
    code: string,
    section?: { kind: 'option' | 'variante'; designation: string; quantity: string },
  ) {
    const created = (
      await as('post', '/affaires').send({ code, name: code, clientId }).expect(201)
    ).body;
    const vId = created.version.id;
    const titre = (
      await as('post', `/versions/${vId}/lines`)
        .send({ type: 'titre', code: '1', designation: 'Base', sortOrder: 1 })
        .expect(201)
    ).body;
    await as('post', `/versions/${vId}/lines`)
      .send({
        type: 'ouvrage', parentLineId: titre.id, designation: 'Ouvrage base',
        sourceOuvrageId: ouvrageId, quantity: '10', sortOrder: 1,
      })
      .expect(201);

    let sectionLineId: string | null = null;
    if (section) {
      const t = (
        await as('post', `/versions/${vId}/lines`)
          .send({
            type: 'titre', code: '2', designation: section.designation,
            sortOrder: 2, sectionType: section.kind,
          })
          .expect(201)
      ).body;
      sectionLineId = t.id;
      await as('post', `/versions/${vId}/lines`)
        .send({
          type: 'ouvrage', parentLineId: t.id, designation: `Ouvrage ${section.kind}`,
          sourceOuvrageId: ouvrageId, quantity: section.quantity, sortOrder: 1,
        })
        .expect(201);
    }

    await as('put', `/versions/${vId}/sale-sheet`)
      .send({
        byNature: {
          labor: { tauxFg: '0', tauxBenefice: '0' },
          material: { tauxFg: '0', tauxBenefice: '20' },
          equipment: { tauxFg: '0', tauxBenefice: '0' },
          subcontract: { tauxFg: '0', tauxBenefice: '0' },
        },
        tvaRate: '0.20',
      })
      .expect(200);
    return { devisId: created.devis.id as string, versionId: vId as string, sectionLineId };
  }

  async function win(devisId: string) {
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${devisId}/transition`).send({ to }).expect(201);
    }
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'AccScreen', 'admin', [
      'core',
      'estimating',
      'invoicing',
    ]));
    clientId = (
      await as('post', '/clients').send({ code: 'CLI-ACC', name: 'Client Acceptation' }).expect(201)
    ).body.id;
    const lib = (await as('post', '/libraries').send({ code: 'LA', name: 'LA' }).expect(201)).body;
    const r = (
      await as('post', `/libraries/${lib.id}/resources`)
        .send({ code: 'RA', label: 'RA', unit: 'u', nature: 'material', unitCost: '100' })
        .expect(201)
    ).body;
    const o = (
      await as('post', `/libraries/${lib.id}/ouvrages`)
        .send({ code: 'OA', label: 'OA', unit: 'u' })
        .expect(201)
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

  it('la file « à accepter » ne retient que les devis gagnés, au montant de VENTE', async () => {
    const gagne = await buildDevis('ACS-1');
    const enCours = await buildDevis('ACS-2'); // reste « En cours »
    await win(gagne.devisId);

    const pending = (await as('get', '/acceptance/pending').expect(200)).body;
    const ids = pending.map((p: { devisId: string }) => p.devisId);
    expect(ids).toContain(gagne.devisId);
    expect(ids).not.toContain(enCours.devisId);

    const row = pending.find((p: { devisId: string }) => p.devisId === gagne.devisId);
    // déboursé 100 × 10 = 1000 ; bénéfice 20 % -> vente 1200 (et non le déboursé)
    expect(row.montantHt).toBe('1200');
    expect(row.clientName).toBe('Client Acceptation');
  });

  it('une fois acceptée, la commande quitte la file et rejoint « acceptés » avec marché + chantier', async () => {
    const d = await buildDevis('ACS-3');
    await win(d.devisId);
    const acc = (await as('post', `/devis/${d.devisId}/accept`).expect(201)).body;

    const pending = (await as('get', '/acceptance/pending').expect(200)).body;
    expect(pending.map((p: { devisId: string }) => p.devisId)).not.toContain(d.devisId);

    const accepted = (await as('get', '/acceptance/accepted').expect(200)).body;
    const row = accepted.find((a: { devisId: string }) => a.devisId === d.devisId);
    expect(row).toBeDefined();
    expect(row.marcheId).toBe(acc.marche.id);
    expect(row.chantierId).toBe(acc.chantier.id);
    expect(row.totalHt).toBe('1200.00');
  });

  it('la fiche d’acceptation donne client, montants, options du devis et chantiers existants', async () => {
    const d = await buildDevis('ACS-4', { kind: 'option', designation: 'Option peinture', quantity: '5' });
    await win(d.devisId);

    const sheet = (await as('get', `/acceptance/devis/${d.devisId}`).expect(200)).body;
    expect(sheet.devis.id).toBe(d.devisId);
    expect(sheet.client.name).toBe('Client Acceptation');
    expect(sheet.montants.pvHt).toBe('1200');
    expect(sheet.montants.tva).toBe('240');
    expect(sheet.montants.ttc).toBe('1440');
    // L'option est chiffrée à part : 100 × 5 × 1,2 = 600
    expect(sheet.sections).toHaveLength(1);
    expect(sheet.sections[0].lineId).toBe(d.sectionLineId);
    expect(sheet.sections[0].sectionType).toBe('option');
    expect(sheet.sections[0].designation).toBe('Option peinture');
    expect(sheet.sections[0].montantHt).toBe('600');
    // Les chantiers déjà ouverts sont proposés comme cible (celui du test précédent existe).
    expect(Array.isArray(sheet.chantiers)).toBe(true);
    expect(sheet.alerts.every((a: { level: string }) => a.level !== 'blocking')).toBe(true);
  });

  it('refuse la fiche d’un devis non gagné avec une alerte bloquante', async () => {
    const d = await buildDevis('ACS-5');
    const sheet = (await as('get', `/acceptance/devis/${d.devisId}`).expect(200)).body;
    expect(sheet.acceptable).toBe(false);
    expect(sheet.alerts.some((a: { level: string }) => a.level === 'blocking')).toBe(true);
  });

  it('crée le marché ET ses budgets d’exécution en un seul geste', async () => {
    const d = await buildDevis('ACS-8');
    await win(d.devisId);
    const acc = (await as('post', `/devis/${d.devisId}/accept`).expect(201)).body;
    // Un marché sans étude d'exécution serait un chantier sans budget : les deux vont ensemble.
    expect(acc.executionLineCount).toBeGreaterThan(0);
    // Le tenant de ce test n'a que la facturation : l'acceptation reste ouverte et matérialise
    // bien les budgets, même si la lecture du suivi de chantier lui est fermée.
    await as('get', `/chantiers/${acc.chantier.id}/execution-tree`).expect(403);
  });

  it('laisse les options et variantes HORS commande — elles s’arbitrent dans le devis', async () => {
    const d = await buildDevis('ACS-6', {
      kind: 'option', designation: 'Option non commandée', quantity: '5',
    });
    await win(d.devisId);
    const acc = (await as('post', `/devis/${d.devisId}/accept`).expect(201)).body;
    // Seul le tronc commun (1 200 €, 1 ouvrage) entre au marché ; l'option de 600 € reste dehors.
    expect(acc.marche.total_ht).toBe('1200.00');
    expect(acc.lineCount).toBe(1);
  });
});
