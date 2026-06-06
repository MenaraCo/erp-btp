/**
 * Seed de démonstration — import depuis CHIFFRAGE (SQLite → PostgreSQL ERP BTP)
 *
 * Importe pour le tenant "demo" :
 *   - Lots (de travaux BTP)
 *   - Codes analytiques + Familles
 *   - Ressources (496 articles)
 *   - Ouvrages + composants
 *   - Clients
 *   - Affaire + Devis + Version + Lignes
 *
 * Usage : node scripts/seed-from-chiffrage.mjs
 */

import { execSync } from 'child_process';
import pg from 'pg';

const CHIFFRAGE_DB = '/Users/menco/Desktop/CHIFFRAGE/server/chiffrage.db';

/* ── SQLite via sqlite3 CLI (pas de dep native) ── */
function sqliteAll(query) {
  const out = execSync(`sqlite3 -json "${CHIFFRAGE_DB}" "${query.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
  if (!out) return [];
  return JSON.parse(out);
}
function sqliteGet(query) { return sqliteAll(query)[0] || null; }

const pgClient = new pg.Client({
  host: 'localhost', port: 5432,
  user: 'erp', password: 'erp', database: 'erp_btp',
});

function natureFromType(t) {
  if (t === 'MO') return 'labor';
  if (t === 'MAT' || t === 'Materiel') return 'equipment';
  if (t === 'ST') return 'subcontract';
  return 'material';
}
function u(s, max = 16) { return s ? String(s).toUpperCase().trim().substring(0, max) : 'U'; }
function s(v, max = 255) { return v ? String(v).substring(0, max) : null; }
function n(v, def = 0) { const x = Number(v); return isNaN(x) ? def : x; }

async function q(sql, params = []) { return pgClient.query(sql, params); }

async function run() {
  await pgClient.connect();

  /* ── tenant demo ── */
  const { rows: [tenant] } = await q(`SELECT id FROM tenant WHERE slug = 'demo' LIMIT 1`);
  if (!tenant) throw new Error('Tenant "demo" introuvable — lance pnpm seed:demo d\'abord');
  const T = tenant.id;
  console.log(`✓ Tenant demo : ${T}`);
  await q(`SET app.current_tenant = '${T}'`);

  /* ════════════════════════════════════════
     1. LOTS DE TRAVAUX BTP
  ════════════════════════════════════════ */
  console.log('\n[1/7] Lots de travaux BTP…');
  const LOTS = [
    ['GO','Gros œuvre'],['CHAR','Charpente'],['COUV','Couverture'],
    ['ETAN','Étanchéité'],['PLOMB','Plomberie'],['ELEC','Électricité'],
    ['CVC','Chauffage / Ventilation / Climatisation'],
    ['MENU','Menuiseries intérieures'],['MENUEXT','Menuiseries extérieures'],
    ['PLAT','Plâtrerie'],['ISOL','Isolation'],
    ['CARRE','Carrelage / Sols durs'],['SOLS','Sols souples'],
    ['PEIN','Peinture'],['CHAP','Chapes'],['FACC','Façade'],
    ['METAL','Serrurerie / Métallerie'],['NETT','Nettoyage'],
    ['VRD','VRD / Aménagements extérieurs'],['DEMO','Démolition / Dépose'],
  ];
  for (const [code, label] of LOTS) {
    await q(`INSERT INTO analytical_lot (tenant_id, nature, code, label)
             VALUES ($1,'material',$2,$3) ON CONFLICT (tenant_id, code) DO NOTHING`,
            [T, code, label]);
  }
  const lotsDb = (await q(`SELECT id, code FROM analytical_lot WHERE tenant_id = $1`, [T])).rows;
  const byLot = Object.fromEntries(lotsDb.map(l => [l.code, l.id]));
  console.log(`  ✓ ${LOTS.length} lots`);

  /* ════════════════════════════════════════
     2. FAMILLES (depuis CHIFFRAGE ref_familles)
  ════════════════════════════════════════ */
  console.log('\n[2/7] Familles…');
  const chiFam = sqliteAll(`SELECT * FROM ref_familles ORDER BY id`);

  function famToLot(code) {
    if (!code) return byLot['CARRE'];
    if (code.startsWith('SD_') || code.startsWith('CH_')) return byLot['CARRE'];
    if (code.startsWith('SS_')) return byLot['SOLS'];
    if (code.startsWith('P_')) return byLot['PEIN'];
    return byLot['NETT'] || lotsDb[0]?.id;
  }

  for (const f of chiFam) {
    await q(`INSERT INTO analytical_famille (tenant_id, lot_id, code, label)
             VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, code) DO NOTHING`,
            [T, famToLot(f.code), s(f.code, 64), s(f.designation)]);
  }
  const famDb = (await q(`SELECT id, code FROM analytical_famille WHERE tenant_id = $1`, [T])).rows;
  const byFam = Object.fromEntries(famDb.map(f => [f.code, f.id]));
  console.log(`  ✓ ${chiFam.length} familles`);

  /* ════════════════════════════════════════
     3. CODES ANALYTIQUES (depuis CHIFFRAGE ref_analytiques)
  ════════════════════════════════════════ */
  console.log('\n[3/7] Codes analytiques…');
  const chiCodes = sqliteAll(`SELECT * FROM ref_analytiques ORDER BY id`);

  function codeToFam(codeNum) {
    const n2 = Number(codeNum);
    if (n2 < 200) return byFam['CH_MO'] || famDb[0]?.id;
    if (n2 < 240) return byFam['SD_CAR'] || famDb[0]?.id;
    if (n2 < 270) return byFam['SS_PVC'] || famDb[0]?.id;
    if (n2 < 300) return byFam['P_PEIN'] || famDb[0]?.id;
    return famDb[0]?.id;
  }

  for (const c of chiCodes) {
    await q(`INSERT INTO analytical_code (tenant_id, famille_id, code, label)
             VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, code) DO NOTHING`,
            [T, codeToFam(c.code), s(String(c.code), 64), s(c.designation)]);
  }
  const codesDb = (await q(`SELECT id, code FROM analytical_code WHERE tenant_id = $1`, [T])).rows;
  const byCode = Object.fromEntries(codesDb.map(c => [c.code, c.id]));
  console.log(`  ✓ ${chiCodes.length} codes analytiques`);

  /* ════════════════════════════════════════
     4. BIBLIOTHÈQUE
  ════════════════════════════════════════ */
  console.log('\n[4/7] Bibliothèque + Ressources…');
  const { rows: [lib] } = await q(
    `INSERT INTO library (tenant_id, code, name)
     VALUES ($1,'CHF','Bibliothèque CHIFFRAGE (démo)')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`, [T]
  );
  const libId = lib.id;

  /* ── Ressources ── */
  const chiRes = sqliteAll(`SELECT * FROM ressources WHERE code IS NOT NULL AND code != '' AND code NOT IN ('oiui','rezrz') AND designation NOT IN ('gdfsdfg','rezrez') ORDER BY code`);

  let resOk = 0;
  for (const r of chiRes) {
    const caId = r.code_analytique ? byCode[String(r.code_analytique)] || null : null;
    try {
      await q(
        `INSERT INTO resource (tenant_id, library_id, code, label, unit, nature, unit_cost,
           code_produit, code_analytique_id, prix_public, unite_achat, coeff_conversion,
           ref_fournisseur, conditionnement)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (tenant_id, library_id, code) DO NOTHING`,
        [
          T, libId,
          s(r.code, 64), s(r.designation), u(r.unite),
          natureFromType(r.type),
          String(n(r.pu_debours)),
          s(r.code, 64), caId,
          String(n(r.prix_public)),
          r.unite_achat ? u(r.unite_achat) : null,
          String(n(r.coeff_conversion, 1)),
          s(r.ref_fournisseur, 128), s(r.conditionnement, 64),
        ]
      );
      resOk++;
    } catch { /* doublon ou contrainte — on passe */ }
  }
  console.log(`  ✓ ${resOk}/${chiRes.length} ressources`);

  /* ════════════════════════════════════════
     5. OUVRAGES + COMPOSANTS
  ════════════════════════════════════════ */
  console.log('\n[5/7] Ouvrages…');
  const chiOuv = sqliteAll(`SELECT * FROM ouvrages WHERE code IS NOT NULL AND code != 'rezrez'`);
  const chiCompo = sqliteAll(`SELECT * FROM ouvrage_composants`);

  const resDb = (await q(`SELECT id, code FROM resource WHERE tenant_id = $1 AND library_id = $2`, [T, libId])).rows;
  const byRes = Object.fromEntries(resDb.map(r => [r.code, r.id]));

  const ouvIdMap = {}; // chiffrage_id → notre uuid
  for (const o of chiOuv) {
    try {
      const { rows: [row] } = await q(
        `INSERT INTO ouvrage (tenant_id, library_id, code, label, unit)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, library_id, code) DO UPDATE SET label = EXCLUDED.label
         RETURNING id`,
        [T, libId, s(o.code, 64), s(o.designation), u(o.unite)]
      );
      ouvIdMap[o.id] = row.id;
    } catch { /* skip */ }
  }

  let compOk = 0;
  for (const c of chiCompo) {
    const ouvrageId = ouvIdMap[c.ouvrage_id];
    if (!ouvrageId || c.type !== 'ressource' || !c.ressource_id) continue;
    const resRow = sqliteGet(`SELECT code FROM ressources WHERE id = ${c.ressource_id}`);
    if (!resRow) continue;
    const resourceId = byRes[resRow.code];
    if (!resourceId) continue;
    try {
      await q(
        `INSERT INTO ouvrage_component (tenant_id, parent_ouvrage_id, kind, child_resource_id, quantity, sort_order)
         VALUES ($1,$2,'resource',$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [T, ouvrageId, resourceId, String(n(c.quantite, 1)), n(c.ordre || c.position || 0)]
      );
      compOk++;
    } catch { /* skip */ }
  }
  console.log(`  ✓ ${Object.keys(ouvIdMap).length} ouvrages, ${compOk} composants`);

  /* ════════════════════════════════════════
     6. CLIENTS
  ════════════════════════════════════════ */
  console.log('\n[6/7] Clients…');
  const chiClients = sqliteAll(`SELECT * FROM clients WHERE nom IS NOT NULL AND nom NOT IN ('vdsfds','')`);
  const clientIdMap = {};

  // client : tenant_id, code, name, email, phone, address (jsonb), vat_number
  let cCode = 1;
  for (const c of chiClients) {
    const nom = c.entreprise || `${c.prenom || ''} ${c.nom}`.trim();
    const addrJson = JSON.stringify({
      adresse: c.adresse || '', cp: c.code_postal || '', ville: c.ville || '', pays: 'France'
    });
    try {
      const { rows: [row] } = await q(
        `INSERT INTO client (tenant_id, code, name, email, phone, address)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (tenant_id, code) DO NOTHING RETURNING id`,
        [T, `CLI-${String(cCode++).padStart(3,'0')}`, nom, s(c.email), s(c.telephone, 32), addrJson]
      );
      if (row) clientIdMap[c.id] = row.id;
    } catch (e) { console.log(`  ⚠ client "${nom}" : ${e.message}`); }
  }
  console.log(`  ✓ ${Object.keys(clientIdMap).length} clients`);

  /* ════════════════════════════════════════
     7. AFFAIRE + DEVIS + VERSION + LIGNES
  ════════════════════════════════════════ */
  console.log('\n[7/7] Affaire & Devis…');
  const firstClientId = Object.values(clientIdMap)[0] || null;

  // Affaire démo principale
  const { rows: [aff] } = await q(
    `INSERT INTO affaire (tenant_id, code, name, client_id, status,
       lieu_execution, budget_objectif)
     VALUES ($1,'AFF-DEMO-001','ST CYR — Rénovation finitions intérieures',$2,'open',
             '{"adresse":"132 Avenue Pierre Brossolette","cp":"92240","ville":"Malakoff","pays":"France"}',
             250000)
     ON CONFLICT DO NOTHING RETURNING id`,
    [T, firstClientId]
  );
  let affaireId = aff?.id;
  if (!affaireId) {
    affaireId = (await q(`SELECT id FROM affaire WHERE tenant_id = $1 AND code = 'AFF-DEMO-001'`, [T])).rows[0]?.id;
  }
  console.log(`  ✓ Affaire id=${affaireId}`);

  // Devis complets CHIFFRAGE
  const chiDevis = sqliteAll(`SELECT * FROM devis WHERE titre IS NOT NULL AND titre != '' AND titre NOT IN ('test') ORDER BY id`);

  let devisCount = 0;
  for (const cd of chiDevis) {
    try {
      // Devis
      // Générer un numéro unique
      const numero = `DEV-DEMO-${String(devisCount + 1).padStart(3,'0')}`;
      const { rows: [dev] } = await q(
        `INSERT INTO devis (tenant_id, affaire_id, numero, designation, type, status, sort_order)
         VALUES ($1,$2,$3,$4,'principal','open',$5) RETURNING id`,
        [T, affaireId, numero, s(cd.titre), devisCount]
      );
      if (!dev) continue;
      const devisId = dev.id;

      // Version 1 — table : devis_version, FK : devis_id (migration 035+036)
      const { rows: [ver] } = await q(
        `INSERT INTO devis_version (tenant_id, devis_id, version_no, label)
         VALUES ($1,$2,1,'Version initiale') RETURNING id`,
        [T, devisId]
      );
      const versionId = ver.id;

      // Sale sheet avec les taux CHIFFRAGE
      await q(
        `INSERT INTO sale_sheet (tenant_id, devis_version_id, coefficients, tva_rate, remise_type, remise_valeur)
         VALUES ($1,$2,$3,$4,'pct',0) ON CONFLICT DO NOTHING`,
        [
          T, versionId,
          JSON.stringify({
            labor:       { tauxFg: cd.taux_fg || 25, tauxBenefice: cd.taux_benefice || 10 },
            material:    { tauxFg: cd.taux_fg || 25, tauxBenefice: cd.taux_benefice || 10 },
            equipment:   { tauxFg: cd.taux_fg || 25, tauxBenefice: cd.taux_benefice || 10 },
            subcontract: { tauxFg: cd.taux_fg || 25, tauxBenefice: cd.taux_benefice || 10 },
          }),
          String(n(cd.tva_globale, 20) / 100),
        ]
      );

      // Lots → Titres → Lignes
      const lots = sqliteAll(`SELECT * FROM devis_lots WHERE devis_id = ${cd.id} ORDER BY ordre`);
      let sort = 0;

      for (const lot of lots) {
        const { rows: [titre] } = await q(
          `INSERT INTO devis_line (tenant_id, devis_version_id, type, designation, sort_order)
           VALUES ($1,$2,'titre',$3,$4) RETURNING id`,
          [T, versionId, s(lot.nom || 'Lot'), sort++]
        );

        const lignes = sqliteAll(`SELECT * FROM devis_lignes WHERE lot_id = ${lot.id} ORDER BY ordre`);
        for (const lg of lignes) {
          try {
            await q(
              `INSERT INTO devis_line (tenant_id, devis_version_id, parent_line_id, type,
                 designation, unit, quantity, pu, sort_order, nature)
               VALUES ($1,$2,$3,'ouvrage',$4,$5,$6,$7,$8,$9)`,
              [
                T, versionId, titre.id,
                s(lg.designation || '—'),
                u(lg.unite), String(n(lg.quantite, 1)),
                String(n(lg.debours_unitaire)), sort++,
                natureFromType(lg.type),
              ]
            );
          } catch { /* skip */ }
        }
      }

      console.log(`  ✓ Devis "${cd.titre}" (${lots.length} titres)`);
      devisCount++;
    } catch (e) {
      console.log(`  ⚠ Devis "${cd.titre}" ignoré : ${e.message}`);
    }
  }

  console.log(`\n✅ Seed CHIFFRAGE terminé !`);
  console.log(`   Lots: ${LOTS.length} | Familles: ${chiFam.length} | Codes: ${chiCodes.length}`);
  console.log(`   Ressources: ${resOk} | Ouvrages: ${Object.keys(ouvIdMap).length}`);
  console.log(`   Clients: ${Object.keys(clientIdMap).length} | Devis: ${devisCount}`);

  await pgClient.end();
}

run().catch(e => { console.error('\n❌', e.message, '\n', e.stack?.split('\n')[1]); process.exit(1); });
