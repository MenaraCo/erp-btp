import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Parc matériel : fiches, affectation aux chantiers, utilisation réelle.
 *
 * Trois règles s'y jouent. Un engin ne peut pas être à deux endroits le même jour. Le chantier
 * paie ce que l'engin y a SERVI, pas ce qu'il a coûté à l'achat. Et une journée déjà relevée ne
 * doit plus compter dans l'engagé, sinon elle serait facturée deux fois au résultat.
 */
describe('Suivi de chantiers — parc matériel', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierA: string;
  let chantierB: string;
  let pelleId: string;
  let codeAnalytiqueId: string;

  function as(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'patch' ? request(s).patch(path)
        : method === 'delete' ? request(s).delete(path) : request(s).post(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(
      app, ds, 'Mat', 'admin', ['site_tracking', 'core', 'financial_management'],
    ));

    chantierA = (await as('post', '/chantiers').send({ name: 'Tour Nord' }).expect(201)).body.id;
    chantierB = (await as('post', '/chantiers').send({ name: 'Villa Sud' }).expect(201)).body.id;

    const lotId = (await as('post', '/params/lots').send({ code: 'MAT', label: 'Matériel' }).expect(201)).body.id;
    const familleId = (await as('post', '/params/familles')
      .send({ lotId, code: 'ENG', label: 'Engins' }).expect(201)).body.id;
    codeAnalytiqueId = (await as('post', '/params/codes')
      .send({ familleId, code: '410', label: 'Pelles mécaniques' }).expect(201)).body.id;

    pelleId = (await as('post', '/materiel')
      .send({
        label: 'Pelle 8T', type: 'engin', propriete: 'parc', marque: 'Kubota',
        immatriculation: 'AB-123-CD', coutUnitaire: '320', uniteCout: 'jour',
        codeAnalytiqueId, dateControleTechnique: '2026-09-15',
        coutAmenee: '250', coutRepli: '250',
      })
      .expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('attribue_un_code_automatiquement_comme_les_autres_fiches', async () => {
    const liste = (await as('get', '/materiel').expect(200)).body;
    const pelle = liste.find((m: { id: string }) => m.id === pelleId);
    expect(pelle.code).toMatch(/^MAT-/);
    expect(pelle.code_analytique).toBe('410');
    expect(Number(pelle.cout_unitaire)).toBe(320);
  });

  it('exige_un_code_analytique_sur_la_fiche_et_impose_la_nature_materiel', async () => {
    // Sans poste, chaque journée de cet engin sortirait des tableaux de bord.
    await as('post', '/materiel')
      .send({ label: 'Compacteur', type: 'engin', coutUnitaire: '90', uniteCout: 'jour' })
      .expect(400);
    // Et on ne peut pas le retirer après coup.
    await as('patch', `/materiel/${pelleId}`).send({ codeAnalytiqueId: null }).expect(400);
  });

  it('refuse_d_affecter_un_engin_a_deux_chantiers_sur_les_memes_jours', async () => {
    await as('post', `/materiel/${pelleId}/affectations`)
      .send({ chantierId: chantierA, dateDebut: '2026-06-01', dateFin: '2026-06-05' })
      .expect(201);

    // Chevauchement d'une seule journée : c'est déjà un engin promis deux fois.
    await as('post', `/materiel/${pelleId}/affectations`)
      .send({ chantierId: chantierB, dateDebut: '2026-06-05', dateFin: '2026-06-10' })
      .expect(400);

    // Après la libération, la même période passe sans discussion.
    const suite = (await as('post', `/materiel/${pelleId}/affectations`)
      .send({ chantierId: chantierB, dateDebut: '2026-06-08', dateFin: '2026-06-10' })
      .expect(201)).body;
    expect(suite.date_debut).toBe('2026-06-08');

    const affectations = (await as('get', '/materiel/affectations?debut=2026-06-01&fin=2026-06-30')
      .expect(200)).body;
    expect(affectations).toHaveLength(2);
    expect(affectations[0].materiel).toBe('Pelle 8T');
  });

  it('le_releve_d_utilisation_reprend_le_cout_de_la_fiche_et_son_poste', async () => {
    const jour = (await as('post', `/materiel/${pelleId}/utilisations`)
      .send({ chantierId: chantierA, date: '2026-06-02', quantite: '1' })
      .expect(201)).body;
    expect(Number(jour.cout_unitaire)).toBe(320);
    expect(Number(jour.cout)).toBe(320);

    // Une demi-journée coûte la moitié, et le coût reste forçable (tarif négocié, panne).
    const demi = (await as('post', `/materiel/${pelleId}/utilisations`)
      .send({ chantierId: chantierA, date: '2026-06-03', quantite: '0.5', coutUnitaire: '300' })
      .expect(201)).body;
    expect(Number(demi.cout)).toBe(150);

    const releves = (await as('get', `/materiel/${pelleId}/utilisations`).expect(200)).body;
    expect(releves).toHaveLength(2);
    expect(releves[0].code_analytique).toBe('410');
  });

  it('le_chantier_paie_ce_qui_a_servi_et_ce_qui_reste_promis_ne_compte_qu_une_fois', async () => {
    const synthese = (await as('get', `/chantiers/${chantierA}/results`).expect(200)).body;
    const materiel = synthese.byNature.find((n: { nature: string }) => n.nature === 'equipment');

    // Réalisé : les deux journées relevées (320 + 150).
    expect(Number(materiel.realise)).toBe(470);
    // Engagé : les jours ouvrés affectés SANS relevé — 1, 4 et 5 juin (le 2 et le 3 sont faits) —
    // plus l'amenée et le repli réservés, que personne n'a encore relevés.
    expect(Number(materiel.engage)).toBe(960 + 500);
  });

  it('amenee_et_repli_sont_engages_a_la_reservation_puis_realises_au_releve', async () => {
    // Le transport se relève comme le reste, mais c'est un forfait, pas des heures.
    await as('post', `/materiel/${pelleId}/utilisations`)
      .send({ chantierId: chantierA, date: '2026-06-01', type: 'amenee', quantite: '1',
        coutUnitaire: '250' })
      .expect(201);

    const synthese = (await as('get', `/chantiers/${chantierA}/results`).expect(200)).body;
    const materiel = synthese.byNature.find((n: { nature: string }) => n.nature === 'equipment');
    // L'amenée passe de l'engagé au réalisé : le total ne bouge pas, sa répartition si.
    expect(Number(materiel.realise)).toBe(470 + 250);
    expect(Number(materiel.engage)).toBe(960 + 250);
  });

  it('modifie_une_reservation_sans_pouvoir_contourner_les_conflits', async () => {
    const affectations = (await as('get', `/materiel/affectations?debut=2026-06-01&fin=2026-06-30&chantier=${chantierB}`)
      .expect(200)).body;
    const reservation = affectations[0];

    const corrigee = (await as('patch', `/materiel/affectations/${reservation.id}`)
      .send({ dateFin: '2026-06-12', coutAmenee: '180', coutRepli: '180' })
      .expect(200)).body;
    expect(corrigee.date_fin).toBe('2026-06-12');
    expect(Number(corrigee.cout_amenee)).toBe(180);

    // Reculer le début sur la mission du chantier A ferait chevaucher : refusé, comme à la création.
    await as('patch', `/materiel/affectations/${reservation.id}`)
      .send({ dateDebut: '2026-06-04' })
      .expect(400);
  });

  it('signale_les_conflits_et_les_echeances_d_entretien', async () => {
    // Un conflit se crée par un chemin qui ne passe pas par le contrôle (reprise de données) :
    // l'écran doit savoir le montrer, pas seulement l'empêcher.
    const conflits = (await as('get', '/materiel/conflits?debut=2026-06-01&fin=2026-06-30')
      .expect(200)).body;
    expect(Array.isArray(conflits)).toBe(true);

    const echeances = (await as('get', '/materiel/echeances?jours=3650').expect(200)).body;
    const pelle = echeances.find((m: { id: string }) => m.id === pelleId);
    expect(pelle.date_controle_technique).toBe('2026-09-15');
    expect(pelle.prochaine_echeance).toBe('2026-09-15');
  });

  it('releve_une_semaine_d_un_coup_sans_ecraser_les_jours_deja_saisis', async () => {
    // Lundi 15 au dimanche 21 juin : cinq jours ouvrés, samedi et dimanche sautés.
    const semaine = (await as('post', `/materiel/${pelleId}/utilisations/periode`)
      .send({ chantierId: chantierB, debut: '2026-06-15', fin: '2026-06-21', quantite: '1' })
      .expect(201)).body;
    expect(semaine.crees).toBe(5);
    expect(semaine.ignores).toBe(0);

    // Rejouer la même semaine ne réécrit rien : une saisie manuelle peut porter une demi-journée
    // ou un tarif négocié, l'écraser en silence serait pire que de ne rien faire.
    const rejeu = (await as('post', `/materiel/${pelleId}/utilisations/periode`)
      .send({ chantierId: chantierB, debut: '2026-06-15', fin: '2026-06-21', quantite: '1' })
      .expect(201)).body;
    expect(rejeu.crees).toBe(0);
    expect(rejeu.ignores).toBe(5);

    // Week-end inclus sur demande : certains chantiers tournent le samedi.
    const avecWeekend = (await as('post', `/materiel/${pelleId}/utilisations/periode`)
      .send({
        chantierId: chantierB, debut: '2026-06-15', fin: '2026-06-21',
        quantite: '1', joursOuvres: false,
      })
      .expect(201)).body;
    expect(avecWeekend.crees).toBe(2);      // samedi et dimanche, le reste étant déjà saisi
  });

  it('compare_ce_que_le_loueur_facture_a_ce_qui_est_impute_aux_chantiers', async () => {
    const camion = (await as('post', '/materiel')
      .send({ label: 'Camion benne', type: 'vehicule', propriete: 'location',
        coutUnitaire: '200', uniteCout: 'jour', codeAnalytiqueId })
      .expect(201)).body.id;
    await as('post', `/materiel/${camion}/utilisations`)
      .send({ chantierId: chantierA, date: '2026-07-06', quantite: '1' })
      .expect(201);

    // Une facture de location saisie sur le chantier, puis rattachée à l'engin. La commande doit
    // être partie avant de pouvoir être facturée : c'est la règle des achats, on la respecte.
    const bc = (await as('post', `/chantiers/${chantierA}/purchase-orders`).send({}).expect(201)).body;
    await as('post', `/purchase-orders/${bc.id}/lines`)
      .send({
        nature: 'equipment', designation: 'Location camion benne — juillet',
        quantity: '1', unitPrice: '900', codeAnalytiqueId,
      })
      .expect(201);
    await as('post', `/purchase-orders/${bc.id}/submit`).expect(201);
    const facture = (await as('post', `/purchase-orders/${bc.id}/invoices`)
      .send({ code: 'LOC-2026-7', nature: 'equipment', amountHt: '900', invoiceDate: '2026-07-31' })
      .expect(201)).body;
    await as('patch', `/materiel/factures/${facture.id}`)
      .send({ equipmentId: camion })
      .expect(200);

    const bilan = (await as('get', `/materiel/${camion}/bilan`).expect(200)).body;
    expect(Number(bilan.impute)).toBe(200);      // une journée imputée au chantier
    expect(Number(bilan.facture)).toBe(900);     // le loueur en facture 900
    // L'écart est l'information utile : 700 € payés que personne ne porte.
    expect(Number(bilan.ecart)).toBe(700);
    expect(bilan.factures).toHaveLength(1);
    expect(bilan.factures[0].code).toBe('LOC-2026-7');
  });

  it('un_engin_qui_a_servi_se_desactive_au_lieu_d_etre_supprime', async () => {
    const r = (await as('delete', `/materiel/${pelleId}`).expect(200)).body;
    expect(r.supprime).toBe(false);
    expect(r.desactive).toBe(true);

    const actifs = (await as('get', '/materiel').expect(200)).body;
    expect(actifs.find((m: { id: string }) => m.id === pelleId)).toBeUndefined();
    const tous = (await as('get', '/materiel?tous=1').expect(200)).body;
    expect(tous.find((m: { id: string }) => m.id === pelleId)).toBeDefined();
  });
});
