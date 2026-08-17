import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Contrats de travail : types réels, contrats à terme, et intérim facturé par une agence.
 *
 * Deux vérités que le fichier salarié ignorait : un CDD sans date de fin est un CDD qu'on oublie,
 * et un intérimaire coûte le taux FACTURÉ par son agence — taux horaire × coefficient — pas son
 * taux horaire nu. Compter le second sous-estime le chantier de moitié à chaque heure.
 */
describe('Suivi de chantiers — contrats de travail et intérim', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let chantierId: string;
  let agenceId: string;
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
    ({ tenantId, userId } = await entitleUser(app, ds, 'Int', 'admin', ['site_tracking', 'core']));

    chantierId = (await as('post', '/chantiers').send({ name: 'Tour Nord' }).expect(201)).body.id;
    agenceId = (await as('post', '/suppliers').send({ name: 'Interim BTP' }).expect(201)).body.id;

    const lotId = (await as('post', '/params/lots').send({ code: 'MO', label: 'MO' }).expect(201)).body.id;
    const familleId = (await as('post', '/params/familles')
      .send({ lotId, code: 'INT', label: 'Intérim' }).expect(201)).body.id;
    codeAnalytiqueId = (await as('post', '/params/codes')
      .send({ familleId, code: '150', label: 'Personnel intérimaire' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('exige_la_date_de_fin_pour_un_contrat_a_duree_determinee', async () => {
    await as('post', '/employees')
      .send({ lastName: 'Martin', firstName: 'Léa', contractType: 'cdd', hourlyCost: '19' })
      .expect(400);

    const avecFin = (await as('post', '/employees')
      .send({
        lastName: 'Martin', firstName: 'Léa', contractType: 'cdd',
        hourlyCost: '19', dateFinContrat: '2026-12-31',
      })
      .expect(201)).body;
    expect(avecFin.contractType).toBe('cdd');
    expect(avecFin.dateFinContrat).toBe('2026-12-31');

    // Un CDI, lui, n'a pas de terme à renseigner.
    const cdi = (await as('post', '/employees')
      .send({ lastName: 'Petit', firstName: 'Jean', contractType: 'cdi', hourlyCost: '21' })
      .expect(201)).body;
    expect(cdi.dateFinContrat).toBeNull();

    // Et faire passer un CDI en stage sans date reste refusé.
    await as('patch', `/employees/${cdi.id}`).send({ contractType: 'stage' }).expect(400);
    await as('patch', `/employees/${cdi.id}`)
      .send({ contractType: 'stage', dateFinContrat: '2026-09-30' }).expect(200);
  });

  it('enregistre_le_contrat_d_agence_avec_ses_indemnites_et_calcule_le_taux_facture', async () => {
    const interimaire = (await as('post', '/employees')
      .send({ lastName: 'Bernard', firstName: 'Yann', contractType: 'interimaire', hourlyCost: '14' })
      .expect(201)).body;

    const contrat = (await as('post', `/employees/${interimaire.id}/interim-contracts`)
      .send({
        supplierId: agenceId,
        reference: 'MIS-2026-118',
        dateDebut: '2026-04-01',
        dateFin: '2026-04-30',
        tauxHoraire: '14',
        coefficient: '1.95',
        codeAnalytiqueId,
        elements: [
          { type: 'panier', montant: '11.50', unite: 'jour', codeAnalytiqueId },
          { type: 'trajet', montant: '4.20', unite: 'jour', codeAnalytiqueId },
          { type: 'ifm', montant: '10', unite: 'pourcentage', codeAnalytiqueId },
        ],
      })
      .expect(201)).body;

    // 14 € × 1,95 = 27,30 € l'heure réellement facturée.
    expect(Number(contrat.taux_facture)).toBe(27.3);
    expect(contrat.fournisseur).toBe('Interim BTP');
    expect(contrat.elements).toHaveLength(3);
    // Les libellés d'usage sont posés d'office : personne ne retape « Indemnité de fin de mission ».
    expect(contrat.elements.find((e: { type: string }) => e.type === 'ifm').label)
      .toBe('Indemnité de fin de mission');
    expect(contrat.elements.every((e: { code_analytique: string }) => e.code_analytique === '150'))
      .toBe(true);
  });

  it('un_pointage_d_interimaire_coute_le_taux_facture_par_l_agence', async () => {
    const interimaire = (await as('post', '/employees')
      .send({ lastName: 'Roux', firstName: 'Ali', contractType: 'interimaire', hourlyCost: '15' })
      .expect(201)).body;
    await as('post', `/employees/${interimaire.id}/interim-contracts`)
      .send({ supplierId: agenceId, dateDebut: '2026-05-01', dateFin: '2026-05-31',
        tauxHoraire: '15', coefficient: '2' })
      .expect(201);

    // Pendant la mission : 8 h à 30 € (15 × 2), pas à 15 €.
    const pendant = (await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ employeeId: interimaire.id, date: '2026-05-12', hours: '8' })
      .expect(201)).body;
    expect(Number(pendant.hourly_cost)).toBe(30);
    expect(Number(pendant.cost)).toBe(240);

    // Hors mission, plus de contrat : on retombe sur la fiche plutôt que de refuser la saisie.
    const apres = (await as('post', `/chantiers/${chantierId}/timesheets`)
      .send({ employeeId: interimaire.id, date: '2026-06-02', hours: '8' })
      .expect(201)).body;
    expect(Number(apres.hourly_cost)).toBe(15);
  });

  it('refuse_un_contrat_d_agence_sur_un_salarie_qui_n_est_pas_en_interim', async () => {
    const cdi = (await as('post', '/employees')
      .send({ lastName: 'Durand', firstName: 'Paul', contractType: 'cdi', hourlyCost: '20' })
      .expect(201)).body;
    await as('post', `/employees/${cdi.id}/interim-contracts`)
      .send({ dateDebut: '2026-04-01', tauxHoraire: '14', coefficient: '1.9' })
      .expect(400);
  });

  it('renegocier_un_contrat_remplace_ses_indemnites_en_bloc', async () => {
    const interimaire = (await as('post', '/employees')
      .send({ lastName: 'Sanchez', firstName: 'Marc', contractType: 'interimaire', hourlyCost: '16' })
      .expect(201)).body;
    const contrat = (await as('post', `/employees/${interimaire.id}/interim-contracts`)
      .send({
        agence: 'Agence locale', dateDebut: '2026-03-01', tauxHoraire: '16', coefficient: '1.8',
        elements: [{ type: 'panier', montant: '10', unite: 'jour' }],
      })
      .expect(201)).body;

    const revu = (await as('patch', `/employees/interim-contracts/${contrat.id}`)
      .send({
        coefficient: '2.05',
        elements: [
          { type: 'panier', montant: '12', unite: 'jour' },
          { type: 'iccp', montant: '10', unite: 'pourcentage' },
        ],
      })
      .expect(200)).body;

    expect(Number(revu.taux_facture)).toBe(32.8);   // 16 × 2,05
    expect(revu.elements).toHaveLength(2);
    expect(revu.elements.some((e: { type: string }) => e.type === 'iccp')).toBe(true);
    // L'ancien panier à 10 € a disparu : un contrat se renégocie en bloc.
    expect(revu.elements.filter((e: { type: string }) => e.type === 'panier')).toHaveLength(1);
    expect(Number(revu.elements.find((e: { type: string }) => e.type === 'panier').montant)).toBe(12);
  });
});
