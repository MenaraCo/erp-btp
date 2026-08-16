import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Éléments variables de paye : rubriques, calcul du mois, relevé signable.
 *
 * Les heures pointées ne paient pas un ouvrier — paniers, déplacements et majorations d'heures
 * supplémentaires s'y ajoutent. Ces tests fixent les deux règles qui font mal quand elles sont
 * fausses : le calcul n'écrase jamais une saisie manuelle, et un relevé signé est figé.
 */
describe('Suivi de chantiers — éléments variables de paye', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let employeeId: string;
  let panierId: string;
  let primeId: string;
  let codeAnalytiqueId: string;
  let chantierB: string;

  const MOIS = '2026-06';

  function as(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'patch' ? request(s).patch(path)
        : method === 'delete' ? request(s).delete(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  /** Pointe `heures` heures le jour donné, sur le chantier de test. */
  async function pointer(jour: string, heures: number) {
    await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ employeeId, date: jour, hours: String(heures), hourlyCost: '20' })
      .expect(201);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Paye', 'admin', ['site_tracking', 'core']));

    chantierId = (await as('post', '/chantiers').send({ name: 'Tour Nord' }).expect(201)).body.id;
    chantierB = (await as('post', '/chantiers').send({ name: 'Villa Sud' }).expect(201)).body.id;
    employeeId = (await as('post', '/employees')
      .send({ lastName: 'Durand', firstName: 'Paul', hourlyCost: '20' })
      .expect(201)).body.id;

    const lotId = (await as('post', '/params/lots').send({ code: 'MO', label: 'Main d’œuvre' }).expect(201)).body.id;
    const familleId = (await as('post', '/params/familles')
      .send({ lotId, code: 'IND', label: 'Indemnités' }).expect(201)).body.id;
    codeAnalytiqueId = (await as('post', '/params/codes')
      .send({ familleId, code: '910', label: 'Paniers et déplacements' }).expect(201)).body.id;

    panierId = (await as('post', '/paye/rubriques')
      .send({
        code: 'PAN', label: 'Panier repas', type: 'panier', unite: 'jour',
        montantUnitaire: '11.50', codeAnalytiqueId, nature: 'labor',
      })
      .expect(201)).body.id;
    // Tranche 35 → 43 h majorée de 25 % : la majoration porte sur le coût horaire du salarié.
    await as('post', '/paye/rubriques')
      .send({
        code: 'HS25', label: 'Heures sup. 25 %', type: 'heures_sup', unite: 'heure',
        seuilDebut: '35', seuilFin: '43', majoration: '0.25', codeAnalytiqueId,
      })
      .expect(201);
    primeId = (await as('post', '/paye/rubriques')
      .send({ code: 'PRIME', label: 'Prime de chantier', type: 'prime', unite: 'forfait' })
      .expect(201)).body.id;

    // Semaine complète du lundi 1er au vendredi 5 juin 2026 : 8 h par jour, soit 40 h.
    for (const jour of ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05']) {
      await pointer(jour, 8);
    }
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('un_jour_travaille_donne_un_panier_quel_que_soit_le_nombre_de_chantiers', async () => {
    const r = (await as('post', `/paye/releves/${employeeId}/calculer?mois=${MOIS}`).expect(201)).body;

    const paniers = r.lignes.filter((l: { code: string }) => l.code === 'PAN');
    const panier = paniers[0];
    expect(paniers.reduce((s: number, l: { quantite: string }) => s + Number(l.quantite), 0)).toBe(5);
    expect(paniers.reduce((s: number, l: { montant: string }) => s + Number(l.montant), 0)).toBe(57.5);
    expect(panier.origine).toBe('auto');
    // La dépense sort du calcul DÉJÀ imputée : sans code analytique, elle n'irait dans aucun
    // tableau de bord, et sans chantier, dans aucun résultat de chantier.
    expect(panier.code_analytique).toBe('910');
    expect(panier.chantier_code).toBeTruthy();
    expect(Number(r.entete.heures_travaillees)).toBe(40);
    expect(Number(r.entete.jours_travailles)).toBe(5);
  });

  it('les_heures_sup_se_comptent_par_semaine_dans_la_tranche_de_la_rubrique', async () => {
    const r = (await as('post', `/paye/releves/${employeeId}/calculer?mois=${MOIS}`).expect(201)).body;

    const hs = r.lignes.filter((l: { code: string }) => l.code === 'HS25');
    expect(hs.reduce((s: number, l: { quantite: string }) => s + Number(l.quantite), 0)).toBe(5);
    // 20 €/h × 25 % = 5 € la majoration, pour 5 heures.
    expect(Number(hs[0].montant_unitaire)).toBe(5);
    expect(hs.reduce((s: number, l: { montant: string }) => s + Number(l.montant), 0)).toBe(25);
  });

  it('le_recalcul_efface_ce_qu_il_a_pose_mais_jamais_une_saisie_manuelle', async () => {
    await as('post', `/paye/releves/${employeeId}/lignes?mois=${MOIS}`)
      .send({ rubriqueId: primeId, quantite: '1', montantUnitaire: '150', commentaire: 'Chantier difficile' })
      .expect(201);

    const r = (await as('post', `/paye/releves/${employeeId}/calculer?mois=${MOIS}`).expect(201)).body;
    const prime = r.lignes.find((l: { code: string }) => l.code === 'PRIME');
    expect(prime).toBeDefined();
    expect(Number(prime.montant)).toBe(150);
    expect(prime.origine).toBe('manuel');
    // Et le panier n'a pas été posé deux fois par les deux calculs successifs.
    expect(r.lignes.filter((l: { code: string }) => l.code === 'PAN')).toHaveLength(1);
    expect(Number(r.entete.montant_rubriques)).toBe(232.5); // 57,50 + 25 + 150
  });

  it('ventile_les_paniers_sur_le_chantier_principal_de_chaque_journee', async () => {
    // Une journée partagée : 6 h sur Villa Sud, 2 h sur Tour Nord — le panier suit Villa Sud,
    // et il n'y en a qu'UN, pas un par chantier visité.
    await as('post', `/chantiers/${chantierB}/timesheets`)
      .send({ employeeId, date: '2026-06-08', hours: '6', hourlyCost: '20' }).expect(201);
    await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ employeeId, date: '2026-06-08', hours: '2', hourlyCost: '20' }).expect(201);

    const r = (await as('post', `/paye/releves/${employeeId}/calculer?mois=${MOIS}`).expect(201)).body;
    const paniers = r.lignes.filter((l: { code: string }) => l.code === 'PAN');
    const total = paniers.reduce((s: number, l: { quantite: string }) => s + Number(l.quantite), 0);
    expect(total).toBe(6);                       // six journées travaillées, six paniers
    expect(paniers.every((l: { code_analytique: string | null }) => l.code_analytique === '910')).toBe(true);
    expect(paniers.every((l: { chantier_code: string | null }) => Boolean(l.chantier_code))).toBe(true);
    // La prime a été saisie sans poste : l'écran le compte au lieu de la laisser filer hors des
    // tableaux de bord sans rien dire.
    expect(r.sansCodeAnalytique).toBe(1);
  });

  it('refuse_de_valider_un_releve_dont_une_ligne_n_a_pas_de_poste_analytique', async () => {
    // La prime a été saisie sans poste : elle ne remonterait dans aucun tableau de bord.
    await as('post', `/paye/releves/${employeeId}/valider?mois=${MOIS}`).expect(400);

    const releve = (await as('get', `/paye/releves/${employeeId}?mois=${MOIS}`).expect(200)).body;
    const prime = releve.lignes.find((l: { code: string }) => l.code === 'PRIME');
    await as('patch', `/paye/lignes/${prime.id}`).send({ codeAnalytiqueId }).expect(200);
    expect((await as('get', `/paye/releves/${employeeId}?mois=${MOIS}`).expect(200)).body
      .sansCodeAnalytique).toBe(0);
  });

  it('un_releve_signe_est_fige_et_seule_une_reouverture_le_rend_modifiable', async () => {
    // On ne signe pas un document que personne n'a arrêté : la validation vient d'abord.
    await as('post', `/paye/releves/${employeeId}/signer?mois=${MOIS}`)
      .send({ nom: 'Paul Durand' })
      .expect(409);

    await as('post', `/paye/releves/${employeeId}/valider?mois=${MOIS}`).expect(201);
    const signe = (await as('post', `/paye/releves/${employeeId}/signer?mois=${MOIS}`)
      .send({ nom: 'Paul Durand' }).expect(201)).body;
    expect(signe.entete.statut).toBe('signe');
    expect(signe.entete.signe_par).toBe('Paul Durand');
    expect(signe.modifiable).toBe(false);

    // Ni recalcul, ni ajout tant que le relevé porte une signature.
    await as('post', `/paye/releves/${employeeId}/calculer?mois=${MOIS}`).expect(409);
    await as('post', `/paye/releves/${employeeId}/lignes?mois=${MOIS}`)
      .send({ rubriqueId: primeId, quantite: '1', montantUnitaire: '50' })
      .expect(409);

    await as('post', `/paye/releves/${employeeId}/rouvrir?mois=${MOIS}`)
      .send({ motif: 'Panier oublié' })
      .expect(201);
    const rouvert = (await as('get', `/paye/releves/${employeeId}?mois=${MOIS}`).expect(200)).body;
    expect(rouvert.entete.statut).toBe('brouillon');
    expect(rouvert.entete.signe_par).toBeNull();
    expect(rouvert.modifiable).toBe(true);
  });

  it('une_rubrique_deja_employee_se_desactive_au_lieu_de_disparaitre', async () => {
    const r = (await as('delete', `/paye/rubriques/${panierId}`).expect(200)).body;
    expect(r.supprimee).toBe(false);
    expect(r.desactivee).toBe(true);

    // Elle sort des rubriques proposées, mais les relevés qui la portent restent lisibles.
    const actives = (await as('get', '/paye/rubriques').expect(200)).body;
    expect(actives.map((x: { code: string }) => x.code)).not.toContain('PAN');
    const releve = (await as('get', `/paye/releves/${employeeId}?mois=${MOIS}`).expect(200)).body;
    expect(releve.lignes.some((l: { code: string }) => l.code === 'PAN')).toBe(true);
  });

  it('exporte_le_mois_pour_la_paye_avec_les_heures_et_les_rubriques', async () => {
    const res = await as('get', `/paye/export?mois=${MOIS}`).expect(200);
    const lignes = res.text.split('\r\n');

    expect(lignes[0]).toContain('Matricule;Nom;Prénom');
    const heures = lignes.find((l) => l.includes('Heures travaillées'));
    expect(heures).toContain('48,00');           // virgule décimale : un tableur français
    const prime = lignes.find((l) => l.includes('PRIME'));
    expect(prime).toContain('150,00');
    expect(res.headers['content-disposition']).toContain(`paye-${MOIS}.csv`);
  });

  it('refuse_un_mois_mal_formé_plutot_que_de_deviner', async () => {
    await as('get', `/paye/releves/${employeeId}?mois=juin`).expect(400);
    await as('get', '/paye/releves?mois=2026-6').expect(400);
  });

  it('liste_les_releves_du_mois_avec_ce_qui_reste_a_calculer', async () => {
    const r = (await as('get', `/paye/releves?mois=${MOIS}`).expect(200)).body;
    const ligne = r.lignes.find((l: { employee_id: string }) => l.employee_id === employeeId);
    expect(ligne.statut).toBe('brouillon');
    expect(Number(ligne.heures_pointees)).toBe(48);
    expect(Number(r.totalRubriques)).toBeGreaterThan(0);
  });
});
