import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';
import { runInTenant } from '../../src/core/tenancy/tenant-transaction';

/**
 * Nettoyage des doublons DÉJÀ en place.
 *
 * La garde à l'écriture empêche d'en créer de nouveaux ; elle ne dit rien de ceux hérités d'un
 * import ou d'une époque sans contrôle. Or un code analytique en double fausse l'agrégation : la
 * même dépense se répartit sur deux lignes, et les totaux par famille ne veulent plus rien dire.
 *
 * Fusionner, c'est réaffecter TOUT ce qui pointait sur le doublon — ressources, commandes,
 * factures, pointages — avant de le supprimer. En oublier un seul laisserait des coûts orphelins.
 */
describe('Plan analytique — fusionner les doublons hérités', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;
  let familleId: string;

  const as = (method: 'get' | 'post' | 'patch', path: string) =>
    request(app.getHttpServer())[method](path)
      .set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);

  /** Pose un code analytique en contournant la garde — comme le ferait un import ancien. */
  const codeHerite = async (code: string, label: string): Promise<string> =>
    (await runInTenant(ds, tenantId, (em) =>
      em.query(
        `INSERT INTO analytical_code (tenant_id, famille_id, code, label, nature)
         VALUES ($1, $2, $3, $4, 'material') RETURNING id`,
        [tenantId, familleId, code, label],
      ),
    ))[0].id as string;

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Fusion', 'admin', [
      'core', 'estimating', 'site_tracking',
    ]));
    const lot = (await as('post', '/params/lots').send({ code: 'FIN', label: 'Finitions' }).expect(201)).body;
    familleId = (await as('post', '/params/familles')
      .send({ lotId: lot.id, code: 'COL', label: 'Collage' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('repère deux entrées qui désignent la même chose', async () => {
    await codeHerite('280', 'Colle');
    await codeHerite('281', 'COLLE');

    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    const g = groupes.find((x: { type: string; libelle: string }) => x.type === 'code' && x.libelle === 'colle');
    expect(g).toBeDefined();
    expect(g.entrees.map((e: { code: string }) => e.code).sort()).toEqual(['280', '281']);
  });

  it("compte les usages, pour savoir lequel garder", async () => {
    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    const g = groupes.find((x: { libelle: string }) => x.libelle === 'colle');
    // Aucun des deux n'est encore utilisé : le relevé doit le dire plutôt que de le taire.
    expect(g.entrees.every((e: { usages: number }) => e.usages === 0)).toBe(true);
  });

  it('réaffecte tout ce qui pointait sur le doublon, puis le supprime', async () => {
    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    const g = groupes.find((x: { libelle: string }) => x.libelle === 'colle');
    const garde = g.entrees.find((e: { code: string }) => e.code === '280');
    const supprime = g.entrees.find((e: { code: string }) => e.code === '281');

    // Une ressource de bibliothèque rattachée au doublon — le cas le plus courant.
    const lib = (await as('post', '/libraries').send({ code: 'L-FUS', name: 'L' }).expect(201)).body;
    const res = (await as('post', `/libraries/${lib.id}/resources`)
      .send({ code: 'COL1', label: 'Colle C2', unit: 'KG', nature: 'material', unitCost: '3' })
      .expect(201)).body;
    await runInTenant(ds, tenantId, (em) =>
      em.query(`UPDATE resource SET code_analytique_id = $1 WHERE id = $2`, [supprime.id, res.id]));

    const r = (await as('post', '/params/doublons/fusionner')
      .send({ type: 'code', gardeId: garde.id, supprimeId: supprime.id }).expect(201)).body;
    expect(r.reaffectes).toBe(1);

    // La ressource pointe désormais sur le survivant…
    const [apres] = await runInTenant(ds, tenantId, (em) =>
      em.query(`SELECT code_analytique_id FROM resource WHERE id = $1`, [res.id]));
    expect(apres.code_analytique_id).toBe(garde.id);

    // …et le doublon a disparu.
    const restants = await runInTenant(ds, tenantId, (em) =>
      em.query(`SELECT code FROM analytical_code WHERE id = ANY($1)`, [[garde.id, supprime.id]]));
    expect(restants.map((x: { code: string }) => x.code)).toEqual(['280']);
  });

  it('le doublon disparaît du relevé une fois fusionné', async () => {
    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    expect(groupes.find((x: { libelle: string }) => x.libelle === 'colle')).toBeUndefined();
  });

  it('refuse de fusionner une entrée avec elle-même, ou un type inconnu', async () => {
    const lot = (await as('post', '/params/lots').send({ code: 'X1', label: 'Divers' }).expect(201)).body;
    await as('post', '/params/doublons/fusionner')
      .send({ type: 'lot', gardeId: lot.id, supprimeId: lot.id }).expect(400);
    await as('post', '/params/doublons/fusionner')
      .send({ type: 'inconnu', gardeId: lot.id, supprimeId: lot.id }).expect(400);
  });

  it('rééditer une fiche sans la renommer reste possible même si un libellé voisin existe', async () => {
    // Deux postes que la normalisation rapproche : « Frais généraux / Part propre » d'un côté,
    // « Frais généraux — part propre » de l'autre. Ils coexistent (l'un vient de la société,
    // l'autre du plan modèle) ; changer la CATÉGORIE de l'un ne doit pas buter sur l'autre.
    const societeId = await codeHerite('601', 'Frais généraux / Part propre');
    // Le second vient du plan modèle, posé par migration : la garde de saisie ne l'a jamais vu.
    await codeHerite('901', 'Frais généraux — part propre');

    const r = (await as('patch', `/params/codes/${societeId}`)
      .send({
        familleId, code: '601', label: 'Frais généraux / Part propre',
        nature: 'material', categorie: 'frais_generaux',
      })
      .expect(200)).body;
    expect(r.categorie).toBe('frais_generaux');

    // En revanche, RENOMMER vers le libellé d'une AUTRE fiche reste refusé.
    await codeHerite('902', 'Assurance décennale');
    await as('patch', `/params/codes/${societeId}`)
      .send({ label: 'Assurance décennale' })
      .expect(409);
  });
  it('repere_un_code_reimporte_qui_garde_son_code_d_origine_dans_le_libelle', async () => {
    // Signature d'un ré-import de bibliothèque : la fiche reprise porte un code neuf et range
    // l'ancien en tête de son libellé. Ni le code ni le libellé ne ressemblent à ceux de la fiche
    // société — le relevé ne voyait donc rien, pendant que la même dépense se comptait deux fois.
    await codeHerite('300', 'SD_Carrelage');
    await codeHerite('MNR-300', '300 — SD_CAR');

    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    const g = groupes.find((x: { type: string; entrees: Array<{ code: string }> }) =>
      x.type === 'code' && x.entrees.some((e) => e.code === 'MNR-300'));
    expect(g).toBeDefined();
    expect(g.entrees.map((e: { code: string }) => e.code).sort()).toEqual(['300', 'MNR-300']);
  });

  it('rapproche_aussi_deux_codes_qui_ne_different_que_par_la_ponctuation', async () => {
    await codeHerite('SD 410', 'Ragréage extérieur');
    await codeHerite('SD-410', 'Ragréage terrasse');

    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    const g = groupes.find((x: { entrees: Array<{ code: string }> }) =>
      x.entrees.some((e) => e.code === 'SD 410'));
    expect(g.entrees.map((e: { code: string }) => e.code).sort()).toEqual(['SD 410', 'SD-410']);
  });

  it('reaffecte_meme_les_tables_qu_aucune_liste_ecrite_a_la_main_ne_nommait', async () => {
    // La fusion s'appuyait sur une liste de tables tenue à la main. Elle en nommait cinq quand
    // seize référençaient le code analytique : le stock, le parc matériel, l'intérim, la paye et
    // les budgets n'y étaient pas, et leur lien — en SET NULL — se serait vidé sans un bruit.
    const garde = await codeHerite('500', 'Enduit');
    const supprime = await codeHerite('501', 'ENDUIT');
    await runInTenant(ds, tenantId, async (em) => {
      await em.query(
        `INSERT INTO stock_article (tenant_id, code, label, unit, code_analytique_id)
         VALUES ($1, 'ART-F', 'Sac d''enduit', 'SAC', $2)`,
        [tenantId, supprime],
      );
      await em.query(
        `INSERT INTO equipment (tenant_id, code, label, code_analytique_id)
         VALUES ($1, 'ENG-F', 'Ponceuse', $2)`,
        [tenantId, supprime],
      );
    });

    const r = (await as('post', '/params/doublons/fusionner')
      .send({ type: 'code', gardeId: garde, supprimeId: supprime }).expect(201)).body;
    expect(r.reaffectes).toBe(2);

    const restes = await runInTenant(ds, tenantId, (em) =>
      em.query(
        `SELECT (SELECT count(*)::int FROM stock_article WHERE code_analytique_id = $1) AS art,
                (SELECT count(*)::int FROM equipment     WHERE code_analytique_id = $1) AS eng`,
        [garde],
      ));
    expect(restes[0]).toEqual({ art: 1, eng: 1 });
  });
  it('s_abstient_de_conseiller_quand_deux_fiches_classees_partagent_un_numero', async () => {
    // Le piège des données réelles : « 216 — CH_MO » (main d'œuvre gros œuvre, ré-importée mais
    // bien classée) et « SD_Mortier » (code 216 de la société) se ressemblent par le seul numéro
    // d'origine. Ce sont deux postes vivants ; les fusionner en effacerait un.
    const autreLot = (await as('post', '/params/lots').send({ code: 'GO', label: 'Gros œuvre' }).expect(201)).body;
    const autreFamille = (await as('post', '/params/familles')
      .send({ lotId: autreLot.id, code: 'MO', label: 'Main d’œuvre' }).expect(201)).body;
    await codeHerite('216', 'SD_Mortier');
    await runInTenant(ds, tenantId, (em) =>
      em.query(
        `INSERT INTO analytical_code (tenant_id, famille_id, code, label, nature)
         VALUES ($1, $2, 'MNR-216', '216 — CH_MO', 'labor')`,
        [tenantId, autreFamille.id],
      ));

    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    const g = groupes.find((x: { entrees: Array<{ code: string }> }) =>
      x.entrees.some((e) => e.code === 'MNR-216'));
    expect(g.entrees).toHaveLength(2);
    // Le relevé les montre — mais ne désigne personne, et la fusion en masse les laissera tranquilles.
    expect(g.gardeId).toBeNull();
  });

  it('conseille_la_fiche_classee_quand_l_autre_ne_l_est_pas', async () => {
    await codeHerite('700', 'Bardage bois');
    const orpheline = await runInTenant(ds, tenantId, (em) =>
      em.query(
        `INSERT INTO analytical_code (tenant_id, code, label, nature)
         VALUES ($1, 'MNR-700', '700 — FAC_BAR', 'material') RETURNING id`,
        [tenantId],
      ));

    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    const g = groupes.find((x: { entrees: Array<{ code: string }> }) =>
      x.entrees.some((e) => e.code === 'MNR-700'));
    const classee = g.entrees.find((e: { code: string }) => e.code === '700');
    expect(g.gardeId).toBe(classee.id);
    expect(classee.rattachement).toBe('Collage');
    expect(g.entrees.find((e: { code: string }) => e.code === 'MNR-700').rattachement).toBeNull();
    expect(orpheline[0].id).toBeDefined();
  });
  it('ne_soude_pas_des_familles_que_leur_seul_prefixe_commun_rapproche', async () => {
    // Un import range ses familles sous le nom de leur lot : « Peinture — P_ACC »,
    // « Peinture — P_CONS », « Peinture — P_REV ». Le préfixe est identique et pourtant ce sont
    // trois familles bien distinctes. Un préfixe ne vaut que s'il désigne un code qui existe.
    const lot = (await as('post', '/params/lots').send({ code: 'PEI', label: 'Peinture' }).expect(201)).body;
    for (const [code, label] of [['P_ACC', 'Peinture — P_ACC'], ['P_CONS', 'Peinture — P_CONS'],
      ['P_REV', 'Peinture — P_REV']]) {
      await as('post', '/params/familles').send({ lotId: lot.id, code, label }).expect(201);
    }

    const groupes = (await as('get', '/params/doublons').expect(200)).body;
    const familles = groupes.filter((g: { type: string }) => g.type === 'famille');
    expect(familles.flatMap((g: { entrees: Array<{ label: string }> }) => g.entrees)
      .filter((e: { label: string }) => e.label.startsWith('Peinture — '))).toHaveLength(0);
  });
});
