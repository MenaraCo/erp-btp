import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Modifier un planning depuis la Gestion du personnel.
 *
 * Un planning qu'on ne peut que remplir n'est pas un planning : la journée se découpe (matin ici,
 * après-midi là), un salarié change de chantier, une intervention se retire. Ces gestes doivent
 * exister ailleurs que dans la grille de saisie d'un chantier — sinon il faut ouvrir chaque
 * chantier pour corriger la semaine d'une seule personne.
 */
describe('Gestion du personnel — édition du planning', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierA: string;
  let chantierB: string;
  let empId: string;

  function as(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
    const s = app.getHttpServer();
    const base = method === 'get' ? request(s).get(path)
      : method === 'post' ? request(s).post(path)
        : method === 'patch' ? request(s).patch(path)
          : request(s).delete(path);
    return base.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'PlanEdit', 'admin', ['estimating', 'site_tracking']));
    chantierA = (await as('post', '/chantiers').send({ name: 'Chantier A' }).expect(201)).body.id;
    chantierB = (await as('post', '/chantiers').send({ name: 'Chantier B' }).expect(201)).body.id;
    empId = (
      await as('post', '/employees').send({ lastName: 'Morel', hourlyCost: '30' }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('partage_une_journee_entre_deux_chantiers_sans_declencher_de_conflit', async () => {
    await as('post', '/personnel/creneaux')
      .send({ kind: 'realise', employeeId: empId, chantierId: chantierA, date: '2026-11-02', debut: '08:00', fin: '12:00' })
      .expect(201);
    await as('post', '/personnel/creneaux')
      .send({ kind: 'realise', employeeId: empId, chantierId: chantierB, date: '2026-11-02', debut: '13:00', fin: '17:00' })
      .expect(201);

    const vue = (await as('get', '/personnel/creneaux?debut=2026-11-02&fin=2026-11-02').expect(200)).body;
    const duJour = vue.creneaux.filter((c: { date: string }) => c.date === '2026-11-02');
    expect(duJour).toHaveLength(2);
    expect(duJour.map((c: { heures: string }) => Number(c.heures))).toEqual([4, 4]);

    const conflits = (await as('get', '/personnel/conflits?debut=2026-11-02&fin=2026-11-02').expect(200)).body;
    expect(conflits.total).toBe(0);
  });

  it('deplacer_un_creneau_horodate_conserve_son_horaire', async () => {
    const cree = (await as('post', '/personnel/creneaux')
      .send({ kind: 'realise', employeeId: empId, chantierId: chantierA, date: '2026-11-03', debut: '08:00', fin: '12:00' })
      .expect(201)).body;

    await as('patch', `/personnel/creneaux/realise/${cree.id}`).send({ date: '2026-11-04' }).expect(200);

    const vue = (await as('get', '/personnel/creneaux?debut=2026-11-04&fin=2026-11-04').expect(200)).body;
    const deplace = vue.creneaux.find((c: { id: string }) => c.id === cree.id);
    expect(deplace.debut).toBe('08:00');
    expect(deplace.fin).toBe('12:00');
    expect(Number(deplace.heures)).toBe(4);
  });

  it('change_le_chantier_et_lhoraire_dun_creneau_puis_le_supprime', async () => {
    const cree = (await as('post', '/personnel/creneaux')
      .send({ kind: 'realise', employeeId: empId, chantierId: chantierA, date: '2026-11-05', debut: '08:00', fin: '12:00' })
      .expect(201)).body;

    const modifie = (await as('patch', `/personnel/creneaux/realise/${cree.id}`)
      .send({ chantierId: chantierB, debut: '09:00', fin: '17:00' })
      .expect(200)).body;
    expect(modifie.chantierId).toBe(chantierB);
    expect(Number(modifie.heures)).toBe(8);

    await as('delete', `/personnel/creneaux/realise/${cree.id}`).expect(200);
    const vue = (await as('get', '/personnel/creneaux?debut=2026-11-05&fin=2026-11-05').expect(200)).body;
    expect(vue.creneaux.find((c: { id: string }) => c.id === cree.id)).toBeUndefined();
  });

  it('pose_des_conges_sur_une_semaine_en_ne_comptant_que_les_jours_ouvres', async () => {
    // Du lundi 7 au dimanche 13 décembre 2026 : cinq jours ouvrés.
    const pose = (await as('post', '/personnel/absences')
      .send({ employeeId: empId, kind: 'conges', debut: '2026-12-07', fin: '2026-12-13' })
      .expect(201)).body;
    expect(pose.jours).toBe(5);

    const liste = (await as('get', '/personnel/absences?debut=2026-12-01&fin=2026-12-31').expect(200)).body;
    expect(liste).toHaveLength(5);
    expect(liste.every((a: { kind: string }) => a.kind === 'conges')).toBe(true);

    // Le calendrier les montre comme des créneaux d'un genre à part.
    const vue = (await as('get', '/personnel/creneaux?debut=2026-12-07&fin=2026-12-11').expect(200)).body;
    const absences = vue.creneaux.filter((c: { kind: string }) => c.kind === 'absence');
    expect(absences).toHaveLength(5);
    expect(absences[0].motif).toBe('conges');
  });

  it('signale_un_salarie_pointe_alors_quil_est_en_conges', async () => {
    await as('post', '/personnel/absences')
      .send({ employeeId: empId, kind: 'conges', debut: '2026-12-14' })
      .expect(201);
    await as('post', '/personnel/creneaux')
      .send({ kind: 'realise', employeeId: empId, chantierId: chantierA, date: '2026-12-14', heures: '7' })
      .expect(201);

    const conflits = (await as('get', '/personnel/conflits?debut=2026-12-14&fin=2026-12-14').expect(200)).body;
    expect(conflits.total).toBe(1);
    expect(conflits.conflits[0].motifs.join(' ')).toMatch(/absence/i);
  });

  it('signale_une_journee_planifiee_alors_que_le_salarie_sera_absent', async () => {
    await as('post', '/personnel/absences')
      .send({ employeeId: empId, kind: 'formation', debut: '2026-12-16' })
      .expect(201);
    await as('post', '/personnel/creneaux')
      .send({ kind: 'prevu', employeeId: empId, chantierId: chantierB, date: '2026-12-16', heures: '7' })
      .expect(201);

    const conflits = (await as('get', '/personnel/conflits?debut=2026-12-16&fin=2026-12-16').expect(200)).body;
    expect(conflits.total).toBe(1);
    expect(conflits.conflits[0].motifs.join(' ')).toMatch(/planifiée/i);
  });

  it('ne_signale_rien_quand_labsence_et_le_chantier_se_partagent_la_journee', async () => {
    // Formation le matin, chantier l'après-midi : la journée est cohérente.
    await as('post', '/personnel/absences')
      .send({ employeeId: empId, kind: 'formation', debut: '2026-12-17', startTime: '08:00', endTime: '12:00' })
      .expect(201);
    await as('post', '/personnel/creneaux')
      .send({ kind: 'realise', employeeId: empId, chantierId: chantierA, date: '2026-12-17', debut: '13:00', fin: '17:00' })
      .expect(201);

    const conflits = (await as('get', '/personnel/conflits?debut=2026-12-17&fin=2026-12-17').expect(200)).body;
    expect(conflits.total).toBe(0);
  });

  it('compte_les_heures_planifiees_dans_lengage_et_les_retire_une_fois_pointees', async () => {
    const resultat = async () => (await as('get', `/chantiers/${chantierB}/results`).expect(200)).body;

    const avant = await resultat();
    const engageAvant = Number(avant.byNature.find((n: { nature: string }) => n.nature === 'labor').engage);

    // Deux journées planifiées à 30 €/h × 7 h = 420 € engagés.
    await as('post', '/personnel/creneaux')
      .send({ kind: 'prevu', employeeId: empId, chantierId: chantierB, date: '2027-01-11', heures: '7' })
      .expect(201);
    await as('post', '/personnel/creneaux')
      .send({ kind: 'prevu', employeeId: empId, chantierId: chantierB, date: '2027-01-12', heures: '7' })
      .expect(201);

    const apres = await resultat();
    const mo = apres.byNature.find((n: { nature: string }) => n.nature === 'labor');
    expect(Number(mo.engage) - engageAvant).toBe(420);

    // Le jour effectivement pointé quitte l'engagé pour le réalisé : jamais compté deux fois.
    await as('post', '/personnel/creneaux')
      .send({ kind: 'realise', employeeId: empId, chantierId: chantierB, date: '2027-01-11', heures: '7' })
      .expect(201);

    const final = await resultat();
    const moFinal = final.byNature.find((n: { nature: string }) => n.nature === 'labor');
    expect(Number(moFinal.engage) - engageAvant).toBe(210);
    expect(Number(moFinal.realise) - Number(mo.realise)).toBe(210);
  });

  it('impute_les_heures_a_un_ouvrage_et_a_un_code_analytique', async () => {
    const cree = (await as('post', '/personnel/creneaux')
      .send({ kind: 'realise', employeeId: empId, chantierId: chantierA, date: '2027-02-01', heures: '7' })
      .expect(201)).body;

    const vue = (await as('get', '/personnel/creneaux?debut=2027-02-01&fin=2027-02-01').expect(200)).body;
    const ligne = vue.creneaux.find((c: { id: string }) => c.id === cree.id);
    expect(ligne.executionLineId).toBeNull();

    // Un ouvrage d'un AUTRE chantier est refusé : les heures suivraient un budget étranger.
    await as('patch', `/personnel/creneaux/realise/${cree.id}`)
      .send({ executionLineId: '00000000-0000-0000-0000-000000000000' })
      .expect(400);
  });

  it('refuse_un_motif_dabsence_inconnu_et_une_periode_a_lenvers', async () => {
    await as('post', '/personnel/absences')
      .send({ employeeId: empId, kind: 'vacances_au_soleil', debut: '2026-12-21' })
      .expect(400);
    await as('post', '/personnel/absences')
      .send({ employeeId: empId, kind: 'conges', debut: '2026-12-21', fin: '2026-12-14' })
      .expect(400);
  });
});
