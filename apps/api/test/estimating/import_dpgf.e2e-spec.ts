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

  it('gating : sans capacité estimating, refus (403)', async () => {
    const other = await entitleUser(app, ds, 'Im2', 'admin', ['site_tracking']);
    await request(app.getHttpServer())
      .post('/imports/devis?format=xml')
      .set('Host', 'localhost').set('X-Tenant-Id', other.tenantId).set('X-User-Id', other.userId)
      .attach('file', Buffer.from(XML, 'utf8'), 'dpgf.xml')
      .expect(403);
  });
});
