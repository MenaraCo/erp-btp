import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { createTestDataSource } from '../support/datasource';
import { buildSocleApp, entitleUser } from '../support/socle-app';

/**
 * Import DPGF (bordereau) → affaire + devis. Vérifie les deux formats (XML standard, Excel),
 * l'arbre titres/ouvrages, le déboursé + PV forcé, et le gating (estimating.bid requis).
 */
describe('Estimating — import DPGF (XML + Excel) → affaire/devis', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tenantId: string;
  let userId: string;

  const auth = (r: request.Test) =>
    r.set('Host', 'localhost').set('X-Tenant-Id', tenantId).set('X-User-Id', userId);

  // Lecture RLS : même connexion avec le tenant courant positionné.
  async function inTenant<T>(sql: string, params: unknown[]): Promise<T[]> {
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
      return (await runner.query(sql, params)) as T[];
    } finally {
      await runner.release();
    }
  }

  beforeAll(async () => {
    ds = await createTestDataSource();
    app = await buildSocleApp();
    ({ tenantId, userId } = await entitleUser(app, ds, 'Im', 'admin', ['estimating']));
  });
  afterAll(async () => { await app.close(); await ds.destroy(); });

  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Etude>
  <Code>DPGF-001</Code><Libelle>Réhabilitation</Libelle><NatureTravaux>Peinture</NatureTravaux>
  <Client><RaisonSociale>ACME SA</RaisonSociale></Client>
  <Documents><Document><ContenuDocument>
    <Ligne_Document xsi:type="Ligne_Titre"><Titre><Libelle>Lot 1 - Peinture</Libelle>
      <ContenuTitre>
        <Ligne_Document xsi:type="Ligne_Ouvrage"><Ouvrage><Code>PM</Code>
          <Libelle_Commercial>Peinture murs</Libelle_Commercial><Unite><Code>M2</Code></Unite>
          <Quantite>100</Quantite><PrixDebourse>5</PrixDebourse><PrixVente>8</PrixVente></Ouvrage>
          <TvaTaux>20</TvaTaux></Ligne_Document>
        <Ligne_Document xsi:type="Ligne_Ouvrage"><Ouvrage><Code>PP</Code>
          <Libelle_Commercial>Peinture plafonds</Libelle_Commercial><Unite><Code>M2</Code></Unite>
          <Quantite>50</Quantite><PrixDebourse>6</PrixDebourse><PrixVente>10</PrixVente></Ouvrage></Ligne_Document>
      </ContenuTitre></Titre></Ligne_Document>
  </ContenuDocument></Document></Documents>
</Etude>`;

  it('XML : crée affaire + devis avec titres/ouvrages, déboursé et PV forcé', async () => {
    const res = await auth(request(app.getHttpServer()).post('/imports/devis?format=xml'))
      .attach('file', Buffer.from(XML, 'utf8'), 'dpgf.xml')
      .expect(201);
    expect(res.body.stats).toEqual({ lots: 1, ouvrages: 2, client: true });
    expect(res.body.numero).toBe('DPGF-001');

    const lines = await inTenant<{ type: string; designation: string; pu: string; pu_vente: string; pu_vente_force: boolean }>(
      `SELECT type, designation, quantity, pu, pu_vente, pu_vente_force FROM devis_line
        WHERE devis_version_id = $1 ORDER BY sort_order`,
      [res.body.versionId],
    );
    const titre = lines.find((l) => l.type === 'titre')!;
    const ouvrages = lines.filter((l) => l.type === 'ouvrage');
    expect(titre.designation).toBe('Lot 1 - Peinture');
    expect(ouvrages).toHaveLength(2);
    expect(Number(ouvrages[0].pu)).toBeCloseTo(5, 2);
    expect(Number(ouvrages[0].pu_vente)).toBeCloseTo(8, 2);
    expect(ouvrages[0].pu_vente_force).toBe(true);
  });

  it('Excel : onglets Informations + Lignes → affaire + devis', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['numero', 'DPGF-XLS'], ['titre', 'Bureaux'], ['client', 'BETA SARL'],
    ]), 'Informations');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['LOT', 'DÉSIGNATION', 'QTE', 'UNITE', 'PU_HT', 'DEBOURS_UNITAIRE'],
      ['Lot 1', 'Cloisons', 10, 'M2', 40, 25],
      ['Lot 1', 'Portes', 4, 'U', 300, 200],
      ['Lot 2', 'Faux plafond', 20, 'M2', 35, 22],
    ]), 'Lignes');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const res = await auth(request(app.getHttpServer()).post('/imports/devis'))
      .attach('file', buffer, 'dpgf.xlsx')
      .expect(201);
    expect(res.body.stats).toEqual({ lots: 2, ouvrages: 3, client: true });

    const ouvrages = await inTenant<{ designation: string; pu: string; pu_vente: string }>(
      `SELECT designation, pu, pu_vente FROM devis_line
        WHERE devis_version_id = $1 AND type='ouvrage' ORDER BY sort_order`,
      [res.body.versionId],
    );
    expect(ouvrages).toHaveLength(3);
    const cloisons = ouvrages.find((o) => o.designation === 'Cloisons')!;
    expect(Number(cloisons.pu)).toBeCloseTo(25, 2);
    expect(Number(cloisons.pu_vente)).toBeCloseTo(40, 2);
  });

  const NOMENCLATURE = `<?xml version="1.0" encoding="UTF-8"?>
<NOMENCLATURE>
  <LES_RESSOURCES><LES_RESS_MX>
    <RESS_MX><CODE>MAT1</CODE><TEXTE_COM>Peinture blanche</TEXTE_COM><UNITE>KG</UNITE>
      <ENT_PU>10</ENT_PU><REMISE1>10</REMISE1><REMISE2>0</REMISE2><FAMILLE>P_PEIN</FAMILLE>
      <PU_MERCURIALE>20</PU_MERCURIALE><ACHAT_FACTEUR>2</ACHAT_FACTEUR></RESS_MX>
  </LES_RESS_MX></LES_RESSOURCES>
  <LES_TACHES>
    <TACHE><CODE>STP_POSE</CODE><TEXTE_COM>Pose sous-traitée</TEXTE_COM><UNITE>M2</UNITE>
      <ENT_PU>15</ENT_PU><FAMILLE>ST</FAMILLE></TACHE>
  </LES_TACHES>
  <LES_OUVRAGES>
    <OUVRAGE><CODE>OUV1</CODE><TEXTE_COM>Peinture pos&#233;e</TEXTE_COM><UNITE>M2</UNITE>
      <SOUS_DETAIL>
        <LIGNE_SOUS_DETAIL><QTE_SAISIE>0.5</QTE_SAISIE><REF_RESS_MX>MAT1</REF_RESS_MX></LIGNE_SOUS_DETAIL>
        <LIGNE_SOUS_DETAIL><QTE_SAISIE>1</QTE_SAISIE><REF_TACHE>STP_POSE</REF_TACHE></LIGNE_SOUS_DETAIL>
      </SOUS_DETAIL></OUVRAGE>
  </LES_OUVRAGES>
</NOMENCLATURE>`;

  it('Nomenclature XML : matériaux/tâches/ouvrages → bibliothèque, débours recalculé', async () => {
    const res = await auth(request(app.getHttpServer()).post('/imports/nomenclature?libraryCode=NOM-TEST&libraryName=Test'))
      .attach('file', Buffer.from(NOMENCLATURE, 'utf8'), 'nomenclature.xml')
      .expect(201);
    expect(res.body.stats).toEqual({ resources: 2, ouvrages: 1, composants: 2, ignores: 0 });

    // Matériau : débours = 10 × (1−10%) = 9 ; tâche ST : 15.
    const resources = await inTenant<{ code: string; nature: string; unit_cost: string; prix_public: string }>(
      `SELECT code, nature, unit_cost, prix_public FROM resource WHERE library_id=$1 ORDER BY code`,
      [res.body.libraryId],
    );
    const mat = resources.find((r) => r.code === 'MAT1')!;
    const st = resources.find((r) => r.code === 'STP_POSE')!;
    expect(mat.nature).toBe('material');
    expect(Number(mat.unit_cost)).toBeCloseTo(9, 2);
    expect(Number(mat.prix_public)).toBeCloseTo(10, 2); // 20 / 2
    expect(st.nature).toBe('subcontract');
    // Ouvrage : 0.5 × 9 + 1 × 15 = 19.5.
    const ouv = await inTenant<{ debourse: string }>(
      `SELECT debourse FROM ouvrage WHERE library_id=$1 AND code='OUV1'`, [res.body.libraryId]);
    expect(Number(ouv[0].debourse)).toBeCloseTo(19.5, 2);
  });

  it('Ressources Excel : colonnes CODE/TYPE/PU → bibliothèque, fournisseurs créés', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['CODE', 'DÉSIGNATION', 'TYPE', 'UNITE', 'PU_PUBLIC', 'PU_DEBOURS', 'FOURNISSEUR'],
      ['R1', 'Enduit', 'M', 'KG', 3, 1.2, 'POINT P'],
      ['R2', 'Maçon', 'MO', 'H', 0, 40, ''],
      ['R3', 'Pose carrelage', 'ST', 'M2', 0, 22, 'SOLDIS'],
    ]), 'Ressources');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const res = await auth(request(app.getHttpServer()).post('/imports/ressources?libraryCode=RES-TEST&libraryName=Res'))
      .attach('file', buffer, 'ressources.xlsx')
      .expect(201);
    expect(res.body.stats.resources).toBe(3);
    expect(res.body.stats.fournisseurs).toBe(2);

    const rows = await inTenant<{ code: string; nature: string; unit_cost: string; prix_public: string }>(
      `SELECT code, nature, unit_cost, prix_public FROM resource WHERE library_id=$1 ORDER BY code`,
      [res.body.libraryId],
    );
    expect(rows.map((r) => r.nature)).toEqual(['material', 'labor', 'subcontract']);
    expect(Number(rows[0].unit_cost)).toBeCloseTo(1.2, 2);
    expect(Number(rows[0].prix_public)).toBeCloseTo(3, 2);
  });

  it('gating : sans capacité estimating, refus (403)', async () => {
    const other = await entitleUser(app, ds, 'Im2', 'admin', ['site_tracking']);
    await request(app.getHttpServer())
      .post('/imports/devis?format=xml')
      .set('Host', 'localhost').set('X-Tenant-Id', other.tenantId).set('X-User-Id', other.userId)
      .attach('file', Buffer.from(XML, 'utf8'), 'dpgf.xml')
      .expect(403);
  });
});
