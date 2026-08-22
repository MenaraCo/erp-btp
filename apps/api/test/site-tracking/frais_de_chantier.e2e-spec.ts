import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Un chantier ne vit pas que du déboursé direct : le devis a aussi prévu des frais généraux et
 * des frais annexes (installation, compte prorata, nettoyage…). Sans eux, le budget de chantier
 * démarre amputé et la marge se dégrade sans qu'on sache pourquoi.
 *
 * L'acceptation les reprend donc poste par poste — mais dans un BON DE BUDGET À TRAITER, pas
 * directement au budget : leur poste analytique et leur signe sont une décision de conduite de
 * chantier (un compte prorata est souvent une recette en moins, pas une dépense en plus), pas
 * quelque chose que le transfert doit trancher tout seul.
 */
describe('Suivi de chantier — reprise des frais de chantier (FG + frais annexes)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let ouvrageId: string;

  function as(method: 'get' | 'post' | 'put' | 'patch', path: string) {
    const server = app.getHttpServer();
    const base =
      method === 'get' ? request(server).get(path)
        : method === 'put' ? request(server).put(path)
          : method === 'patch' ? request(server).patch(path)
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

  it('reprend les frais du devis dans un bon de budget À TRAITER, pas dans le budget', async () => {
    const acc = await acceptDevis('FRC-1');
    const bons = (await as('get', `/chantiers/${acc.chantier.id}/budgets/bons`).expect(200)).body;
    expect(bons).toHaveLength(1);
    expect(bons[0].source).toBe('transfert');
    expect(bons[0].statut).toBe('a_traiter');
    // déboursé 1 000 × FG 10 % = 100 (le bénéfice de 20 % n'est pas un coût)
    const total = bons[0].lignes.reduce((t: number, l: { montant: string }) => t + Number(l.montant), 0);
    expect(total).toBe(100);
    // Aucune ligne n'a de poste : c'est justement ce qu'on vient y mettre.
    expect(bons[0].lignes.every((l: { code_analytique_id: string | null }) => !l.code_analytique_id)).toBe(true);

    // Tant que le bon n'est pas traité, ces 100 € ne pèsent nulle part.
    const results = (await as('get', `/chantiers/${acc.chantier.id}/results`).expect(200)).body;
    expect(Number(results.totals.budgetObjectif)).toBe(1000);
  });

  it('reprend chaque poste de frais annexes sous son intitulé, noyé comme séparé', async () => {
    const acc = await acceptDevis('FRC-2', [
      { designation: 'Installation de chantier', type: 'fixe', valeur: '300', mode: 'separe' },
      { designation: 'Compte prorata', type: 'fixe', valeur: '200', mode: 'inclus' },
    ]);
    const bons = (await as('get', `/chantiers/${acc.chantier.id}/budgets/bons`).expect(200)).body;
    const labels = bons[0].lignes.map((l: { libelle: string }) => l.libelle);
    expect(labels).toContain('Installation de chantier');
    expect(labels).toContain('Compte prorata'); // noyé dans les PU du devis, mais bien à payer
    // FG 100 + 300 + 200
    const total = bons[0].lignes.reduce((t: number, l: { montant: string }) => t + Number(l.montant), 0);
    expect(total).toBe(600);
  });

  it('une fois traité, chaque poste rejoint le bloc que sa catégorie désigne', async () => {
    const acc = await acceptDevis('FRC-4', [
      { designation: 'Compte prorata', type: 'fixe', valeur: '200', mode: 'inclus' },
    ]);
    const chantierId = acc.chantier.id;
    const lotId = (await as('post', '/params/lots').send({ code: 'FRC-L', label: 'Structure' }).expect(201)).body.id;
    const familleId = (await as('post', '/params/familles')
      .send({ lotId, code: 'FRC-F', label: 'Frais', nature: 'material' }).expect(201)).body.id;
    const codeFg = (await as('post', '/params/codes')
      .send({ familleId, code: 'FRC-900', label: 'Frais généraux chantier', categorie: 'frais_generaux' })
      .expect(201)).body.id;
    const codeProduit = (await as('post', '/params/codes')
      .send({ familleId, code: 'FRC-860', label: 'Prorata retenu', categorie: 'produit' })
      .expect(201)).body.id;

    const bon = (await as('get', `/chantiers/${chantierId}/budgets/bons`).expect(200)).body[0];
    for (const ligne of bon.lignes) {
      const prorata = ligne.libelle.toLowerCase().includes('prorata');
      await as('patch', `/chantiers/${chantierId}/budgets/bons/lignes/${ligne.id}`)
        .send(
          prorata
            // Le prorata est retenu par le client : une recette en MOINS, donc un montant négatif.
            ? { codeAnalytiqueId: codeProduit, montant: `-${ligne.montant}` }
            : { codeAnalytiqueId: codeFg },
        )
        .expect(200);
      await as('post', `/chantiers/${chantierId}/budgets/bons/lignes/${ligne.id}/acceptation`)
        .send({ accepte: true }).expect(201);
    }
    const r = (await as('post', `/chantiers/${chantierId}/budgets/bons/${bon.id}/traiter`).expect(201)).body;
    expect(r.anomalies).toHaveLength(0);
    expect(r.traitees).toBe(bon.lignes.length);

    const b = (await as('get', `/chantiers/${chantierId}/budgets`).expect(200)).body;
    expect(Number(b.fraisGeneraux.total.global)).toBe(100);   // les FG de la feuille de vente
    expect(Number(b.produits.lignes[0].metrics.global)).toBe(-200); // le prorata, en recette négative
    // Et le bon a disparu de la file : il est traité.
    const restants = (await as('get', `/chantiers/${chantierId}/budgets/bons`).expect(200)).body;
    expect(restants[0].statut).toBe('traite');
  });

  it('refuse de traiter une ligne sans poste analytique, et le dit', async () => {
    const acc = await acceptDevis('FRC-5');
    const chantierId = acc.chantier.id;
    const bon = (await as('get', `/chantiers/${chantierId}/budgets/bons`).expect(200)).body[0];
    await as('post', `/chantiers/${chantierId}/budgets/bons/lignes/${bon.lignes[0].id}/acceptation`)
      .send({ accepte: true }).expect(201);

    const r = (await as('post', `/chantiers/${chantierId}/budgets/bons/${bon.id}/traiter`).expect(201)).body;
    expect(r.traitees).toBe(0);
    expect(r.anomalies[0].raison).toContain('poste analytique');
    // La ligne reste en attente : rien n'est budgété par accident.
    const apres = (await as('get', `/chantiers/${chantierId}/budgets/bons`).expect(200)).body[0];
    expect(apres.statut).toBe('a_traiter');
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

  it('les frais en attente ne polluent ni les résultats ni la branche « À ventiler »', async () => {
    const acc = await acceptDevis('FRC-6', [
      { designation: 'Nettoyage', type: 'fixe', valeur: '150', mode: 'separe' },
    ]);
    const res = (
      await as('get', `/chantiers/${acc.chantier.id}/analytical-results`).expect(200)
    ).body;
    // Un frais non traité n'est pas « mal rangé » : il n'est pas encore budgété du tout.
    expect(Number(res.siteOverhead.metrics.budgetObjectif)).toBe(0);
    const aVentilerLabels = res.aVentiler.resources.map((r: { label: string }) => r.label);
    expect(aVentilerLabels).not.toContain('Nettoyage');
    // Il attend, visible, dans son bon.
    const bon = (await as('get', `/chantiers/${acc.chantier.id}/budgets/bons`).expect(200)).body[0];
    expect(bon.lignes.map((l: { libelle: string }) => l.libelle)).toContain('Nettoyage');
  });
});
