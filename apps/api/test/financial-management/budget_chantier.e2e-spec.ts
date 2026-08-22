import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Les budgets d'un chantier : étude d'exécution (calculée) + mouvements saisis = budget global,
 * et le budget initial figé comme référence.
 *
 * Le point sensible est le RIPAGE : déplacer du budget d'une ressource vers une autre doit être
 * à somme nulle, tracé (qui, quand, pourquoi) et refusé si la source n'a pas de quoi donner —
 * sans quoi le « budget global » devient une variable d'ajustement invisible.
 */
describe('Suivi de chantier — budgets, ripages horodatés et budget initial', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let codeColle: string;
  let codeAdhesif: string;
  let ressourceId: string;

  function as(method: 'get' | 'post' | 'put' | 'delete', path: string) {
    const s = app.getHttpServer();
    const base =
      method === 'get' ? request(s).get(path)
        : method === 'put' ? request(s).put(path)
          : method === 'delete' ? request(s).delete(path)
            : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Budg', 'admin', [
      'estimating', 'site_tracking', 'invoicing', 'financial_management', 'core',
    ]));

    // Plan analytique : une famille matériaux, deux codes.
    const lotId = (await as('post', '/params/lots').send({ code: 'GO', label: 'Gros œuvre' }).expect(201)).body.id;
    const familleId = (await as('post', '/params/familles')
      .send({ lotId, code: 'MAC', label: 'Maçonnerie', nature: 'material' }).expect(201)).body.id;
    codeColle = (await as('post', '/params/codes')
      .send({ familleId, code: '280', label: 'Colle' }).expect(201)).body.id;
    codeAdhesif = (await as('post', '/params/codes')
      .send({ familleId, code: '281', label: 'Adhésif' }).expect(201)).body.id;

    // Devis accepté → chantier : 10 × (1 ressource à 100) = 1 000 € de budget d'étude.
    const lib = (await as('post', '/libraries').send({ code: 'LB', name: 'LB' }).expect(201)).body;
    const res = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'RB', label: 'Colle carrelage', unit: 'sac', nature: 'material', unitCost: '100' })
      .expect(201)).body;
    const ouv = (await as('post', `/libraries/${lib.id}/ouvrages`)
      .send({ code: 'OB', label: 'Pose', unit: 'm2' }).expect(201)).body;
    await as('post', `/ouvrages/${ouv.id}/components`)
      .send({ kind: 'resource', childResourceId: res.id, quantity: '1' }).expect(201);

    const affaire = (await as('post', '/affaires').send({ code: 'BUD-1', name: 'Budget' }).expect(201)).body;
    await as('post', `/versions/${affaire.version.id}/lines`)
      .send({ type: 'ouvrage', code: '1', designation: 'Pose', sourceOuvrageId: ouv.id, quantity: '10' })
      .expect(201);
    await as('put', `/versions/${affaire.version.id}/sale-sheet`)
      .send({
        byNature: {
          labor: { tauxFg: '0', tauxBenefice: '0' },
          material: { tauxFg: '0', tauxBenefice: '0' },
          equipment: { tauxFg: '0', tauxBenefice: '0' },
          subcontract: { tauxFg: '0', tauxBenefice: '0' },
        },
        tvaRate: '0.20',
      })
      .expect(200);
    for (const to of ['sent', 'won']) {
      await as('post', `/devis/${affaire.devis.id}/transition`).send({ to }).expect(201);
    }
    const acc = (await as('post', `/devis/${affaire.devis.id}/accept`).expect(201)).body;
    chantierId = acc.chantier.id;

    // La ressource du chantier reçoit son code analytique : sans lui, rien n'est ripable.
    const nomenclature = (await as('get', `/chantiers/${chantierId}/nomenclature`).expect(200)).body;
    ressourceId = nomenclature[0].id;
    await as('put', `/chantiers/${chantierId}/nomenclature/${ressourceId}/code-analytique`)
      .send({ codeAnalytiqueId: codeColle })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('budget_global_egale_budget_etude_plus_mouvements_saisis', async () => {
    const avant = (await as('get', `/chantiers/${chantierId}/budgets`).expect(200)).body;
    expect(Number(avant.total.etude)).toBeCloseTo(1000, 2);
    expect(Number(avant.total.global)).toBeCloseTo(1000, 2);
    expect(Number(avant.total.mouvements)).toBeCloseTo(0, 2);

    await as('post', `/chantiers/${chantierId}/budgets/mouvements`)
      .send({ codeAnalytiqueId: codeAdhesif, libelle: 'Enveloppe adhésif', montant: '500' })
      .expect(201);

    const apres = (await as('get', `/chantiers/${chantierId}/budgets`).expect(200)).body;
    expect(Number(apres.total.etude)).toBeCloseTo(1000, 2);
    expect(Number(apres.total.mouvements)).toBeCloseTo(500, 2);
    expect(Number(apres.total.global)).toBeCloseTo(1500, 2);
  });

  it('les_mouvements_de_budget_entrent_dans_le_budget_du_controle_de_gestion', async () => {
    const results = (await as('get', `/chantiers/${chantierId}/results`).expect(200)).body;
    // 1 000 d'étude + 500 saisis : le contrôle de gestion compare la dépense à la cible réelle.
    expect(Number(results.totals.budgetObjectif)).toBeCloseTo(1500, 2);
  });

  it('ripage_entre_ressources_est_a_somme_nulle_trace_et_horodate', async () => {
    const avant = (await as('get', `/chantiers/${chantierId}/budgets`).expect(200)).body;

    await as('post', `/chantiers/${chantierId}/budgets/ripages`)
      .send({
        sourceRessourceId: ressourceId,
        cibleCodeAnalytiqueId: codeAdhesif,
        montant: '200',
        motif: 'Moins de colle, plus d’adhésif',
      })
      .expect(201);

    const apres = (await as('get', `/chantiers/${chantierId}/budgets`).expect(200)).body;
    // Un ripage DÉPLACE : le budget global du chantier ne bouge pas d'un centime.
    expect(Number(apres.total.global)).toBeCloseTo(Number(avant.total.global), 2);

    const histo = (await as('get', `/chantiers/${chantierId}/budgets/historique`).expect(200)).body;
    const jambes = histo.filter((h: { type: string }) => h.type === 'ripage');
    expect(jambes).toHaveLength(2);
    expect(jambes[0].transfer_group_id).toBe(jambes[1].transfer_group_id);
    expect(
      jambes.reduce((t: number, j: { montant: string }) => t + Number(j.montant), 0),
    ).toBeCloseTo(0, 2);
    expect(jambes[0].motif).toContain('adhésif');
    expect(jambes[0].created_at).toBeTruthy();
    expect(jambes[0].auteur).toBeTruthy();
  });

  it('ripage_refuse_quand_la_source_n_a_pas_le_budget', async () => {
    const r = await as('post', `/chantiers/${chantierId}/budgets/ripages`)
      .send({
        sourceRessourceId: ressourceId,
        cibleCodeAnalytiqueId: codeAdhesif,
        montant: '99999',
        motif: 'Test',
      })
      .expect(400);
    expect(String(r.body.message)).toContain('insuffisant');
  });

  it('ripage_refuse_sans_motif', async () => {
    await as('post', `/chantiers/${chantierId}/budgets/ripages`)
      .send({ sourceRessourceId: ressourceId, cibleCodeAnalytiqueId: codeAdhesif, montant: '10' })
      .expect(400);
  });

  it('une_photo_de_budget_fige_le_global_du_moment_et_ne_bouge_plus', async () => {
    const fige = (await as('post', `/chantiers/${chantierId}/budgets/photos`)
      .send({ niveau: 'etude', commentaire: 'Budget arrêté après étude' }).expect(201)).body;
    expect(fige.fixedAt).toBeTruthy();
    expect(fige.version).toBe(1);

    const apresFixation = (await as('get', `/chantiers/${chantierId}/budgets`).expect(200)).body;
    expect(Number(apresFixation.total.initial)).toBeCloseTo(Number(apresFixation.total.global), 2);

    // Une dotation ultérieure éloigne le global de l'initial : c'est exactement ce qu'on veut voir.
    await as('post', `/chantiers/${chantierId}/budgets/mouvements`)
      .send({ codeAnalytiqueId: codeColle, libelle: 'Aléa', montant: '300' })
      .expect(201);

    const apres = (await as('get', `/chantiers/${chantierId}/budgets`).expect(200)).body;
    expect(Number(apres.total.initial)).toBeCloseTo(Number(apresFixation.total.initial), 2);
    expect(Number(apres.total.global)).toBeCloseTo(Number(apresFixation.total.global) + 300, 2);
  });

  it('annuler_un_ripage_retire_ses_deux_jambes', async () => {
    const histo = (await as('get', `/chantiers/${chantierId}/budgets/historique`).expect(200)).body;
    const jambe = histo.find((h: { type: string }) => h.type === 'ripage');
    const r = (await as('delete', `/chantiers/${chantierId}/budgets/mouvements/${jambe.id}`).expect(200)).body;
    expect(r.supprimes).toBe(2);

    const reste = (await as('get', `/chantiers/${chantierId}/budgets/historique`).expect(200)).body;
    expect(reste.filter((h: { type: string }) => h.type === 'ripage')).toHaveLength(0);
  });

  it('les_ressources_du_chantier_affichent_leur_budget_disponible', async () => {
    const ressources = (await as('get', `/chantiers/${chantierId}/budgets/ressources`).expect(200)).body;
    const colle = ressources.find((x: { id: string }) => x.id === ressourceId);
    expect(Number(colle.etude)).toBeCloseTo(1000, 2);
    // Le ripage vient d'être annulé : la ressource retrouve son budget d'étude.
    expect(Number(colle.global)).toBeCloseTo(1000, 2);
    expect(colle.codeAnalytique).toBe('280');
  });

  it('reviser_un_budget_cree_une_version_sans_effacer_la_photo_precedente', async () => {
    // La photo du départ existe déjà (test précédent). On dote, puis on refige : la nouvelle
    // version succède, l'ancienne reste — c'est elle qui dit ce qu'on visait au départ.
    const avant = (await as('get', `/chantiers/${chantierId}/budgets/photos`).expect(200)).body;
    const v1 = avant.find((p: { niveau: string; version: number }) => p.niveau === 'etude' && p.version === 1);
    expect(v1).toBeDefined();

    await as('post', `/chantiers/${chantierId}/budgets/mouvements`)
      .send({ codeAnalytiqueId: codeAdhesif, libelle: 'Aléa de chantier', montant: '400' })
      .expect(201);
    const v2 = (await as('post', `/chantiers/${chantierId}/budgets/photos`)
      .send({ niveau: 'etude', commentaire: 'Révision après aléa' }).expect(201)).body;
    expect(v2.version).toBe(2);

    const photos = (await as('get', `/chantiers/${chantierId}/budgets/photos`).expect(200)).body;
    const etudes = photos.filter((p: { niveau: string }) => p.niveau === 'etude');
    expect(etudes).toHaveLength(2);
    // Seule la dernière fait référence ; l'autre reste consultable.
    expect(etudes.find((p: { version: number }) => p.version === 2).en_vigueur).toBe(true);
    expect(etudes.find((p: { version: number }) => p.version === 1).en_vigueur).toBe(false);
    // Et les deux photos ne disent pas la même chose : la seconde a encaissé l'aléa.
    const chargesV1 = Number(etudes.find((p: { version: number }) => p.version === 1).total_charges);
    const chargesV2 = Number(etudes.find((p: { version: number }) => p.version === 2).total_charges);
    expect(chargesV2 - chargesV1).toBeGreaterThanOrEqual(400);

    // Le tableau se compare par défaut à la DERNIÈRE photo, et sur demande à celle du départ.
    const parDefaut = (await as('get', `/chantiers/${chantierId}/budgets`).expect(200)).body;
    expect(parDefaut.reference.version).toBe(2);
    const contreV1 = (await as('get', `/chantiers/${chantierId}/budgets?reference=${v1.id}`).expect(200)).body;
    expect(contreV1.reference.version).toBe(1);
    // La colonne de référence montre bien la photo DEMANDÉE : ses charges et ses frais généraux.
    const attendu = Number(v1.total_charges) + Number(v1.total_frais_generaux);
    expect(Number(contreV1.total.initial)).toBeCloseTo(attendu, 2);
    expect(Number(contreV1.total.initial)).toBeLessThan(Number(parDefaut.total.initial));
  });

  it('refuse_un_niveau_de_budget_inconnu', async () => {
    await as('post', `/chantiers/${chantierId}/budgets/photos`)
      .send({ niveau: 'brouillon' }).expect(400);
    await as('post', `/chantiers/${chantierId}/budgets/photos`).send({}).expect(400);
  });
});
