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
    // Engagé : les jours ouvrés affectés SANS relevé — 1, 4 et 5 juin (le 2 et le 3 sont faits).
    expect(Number(materiel.engage)).toBe(960);
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
