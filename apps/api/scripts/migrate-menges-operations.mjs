// Migration MENGES → app : clients, affaires, devis (arbre lots/ouvrages/sous-détail + coefficients).
// Idempotent : clients/affaires upsert par code ; devis créé une seule fois (skip si numéro déjà importé).
// NON destructif, tenant demo. Usage : node scripts/migrate-menges-operations.mjs [menara.db]
import { execFileSync } from 'node:child_process';
import pglib from '../node_modules/pg/lib/index.js';

const SQLITE_DB = process.argv[2] || '/Users/menco/Desktop/Projets/MENARA/database/menara.db';
const PG = { host: 'localhost', port: 5432, user: 'erp', password: 'erp', database: 'erp_btp' };
const TENANT_SLUG = 'demo';
const NATURE = { M: 'material', MO: 'labor', ST: 'subcontract', MAT: 'equipment' };
const DEVIS_STATUS = { accepte: 'won', brouillon: 'open', envoye: 'sent', refuse: 'lost', gagne: 'won', perdu: 'lost' };

function sqlite(sql) {
  const out = execFileSync('sqlite3', ['-json', SQLITE_DB, sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : [];
}
const num = (v) => (v == null || v === '' ? 0 : Number(String(v).replace(',', '.')) || 0);
const slug = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function main() {
  const clients = sqlite(`SELECT id, nom, prenom, entreprise, email, telephone, adresse, ville, code_postal, siret FROM clients ORDER BY id`);
  const affaires = sqlite(`SELECT id, code, nom, client_id, statut, budget, notes FROM affaires ORDER BY id`);
  const devis = sqlite(`SELECT id, numero, client_id, titre, objet, statut, taux_fg, taux_benefice, tva_globale,
    remise_globale, remise_type, taux_par_type FROM devis ORDER BY id`);
  const lots = sqlite(`SELECT id, devis_id, nom, ordre, niveau, num_custom FROM devis_lots ORDER BY devis_id, ordre`);
  const lignes = sqlite(`SELECT id, devis_id, lot_id, designation, quantite, unite, debours_unitaire, prix_unitaire_ht, type, ordre, num_custom FROM devis_lignes ORDER BY devis_id, ordre`);
  const comps = sqlite(`SELECT id, ligne_id, designation, type, ratio, perte, pu_debours, code, unite, ordre FROM devis_ligne_composants ORDER BY ligne_id, ordre`);
  const frais = sqlite(`SELECT devis_id, designation, type, valeur, ordre FROM devis_frais_annexes ORDER BY devis_id, ordre`);
  const links = sqlite(`SELECT affaire_id, devis_id FROM affaire_devis`);
  console.log(`MENGES : ${clients.length} clients, ${affaires.length} affaires, ${devis.length} devis, ${lots.length} lots, ${lignes.length} lignes, ${comps.length} composants`);

  const c = new pglib.Client(PG);
  await c.connect();
  try {
    const tenantId = (await c.query(`SELECT id FROM tenant WHERE slug=$1`, [TENANT_SLUG])).rows[0].id;
    await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

    // 1) Clients (upsert par code).
    const usedClientCodes = new Set((await c.query(`SELECT code FROM client WHERE tenant_id=$1`, [tenantId])).rows.map((r) => r.code));
    const clientMap = new Map();
    for (const cl of clients) {
      const name = (cl.entreprise || `${cl.nom || ''} ${cl.prenom || ''}`.trim() || 'Client').slice(0, 255);
      let code = slug(cl.entreprise || cl.nom) || `CLI-${cl.id}`;
      if (usedClientCodes.has(code)) code = `${code}-${cl.id}`.slice(0, 64);
      usedClientCodes.add(code);
      const hasAddr = cl.adresse || cl.ville || cl.code_postal;
      const address = hasAddr
        ? JSON.stringify({ ligne1: cl.adresse || null, code_postal: cl.code_postal || null, ville: cl.ville || null })
        : null;
      const row = (await c.query(
        `INSERT INTO client (tenant_id, code, name, vat_number, email, phone, address)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (tenant_id, code) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email,
           phone=EXCLUDED.phone, address=EXCLUDED.address, updated_at=now() RETURNING id`,
        [tenantId, code, name, cl.siret || null, cl.email || null, cl.telephone || null, address],
      )).rows[0];
      clientMap.set(cl.id, row.id);
    }
    console.log(`✔ ${clientMap.size} clients`);

    // 2) Affaires (upsert par code).
    const affaireMap = new Map(); // menges affaire id → our uuid
    const usedAffaireCodes = new Set((await c.query(`SELECT code FROM affaire WHERE tenant_id=$1`, [tenantId])).rows.map((r) => r.code));
    const ensureAffaire = async (code, name, clientId, status, budget) => {
      let cd = slug(code) || 'AFF';
      const row = (await c.query(
        `INSERT INTO affaire (tenant_id, code, name, client_id, status, budget_objectif)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, code) DO UPDATE SET name=EXCLUDED.name, updated_at=now() RETURNING id`,
        [tenantId, cd.slice(0, 64), (name || cd).slice(0, 255), clientId, status || 'en_cours', budget ? budget.toFixed(2) : null],
      )).rows[0];
      usedAffaireCodes.add(cd);
      return row.id;
    };
    for (const a of affaires) {
      const id = await ensureAffaire(a.code, a.nom, clientMap.get(a.client_id) ?? null, 'en_cours', num(a.budget));
      affaireMap.set(a.id, id);
    }
    console.log(`✔ ${affaireMap.size} affaires`);

    // devis → affaire (via affaire_devis).
    const devisAffaire = new Map();
    for (const l of links) if (affaireMap.has(l.affaire_id)) devisAffaire.set(l.devis_id, affaireMap.get(l.affaire_id));

    // Index lots/lignes/comps/frais par devis.
    const byDevis = (arr, key = 'devis_id') => { const m = new Map(); for (const x of arr) { const k = x[key]; (m.get(k) ?? m.set(k, []).get(k)).push(x); } return m; };
    const lotsByDevis = byDevis(lots);
    const lignesByDevis = byDevis(lignes);
    const compsByLigne = byDevis(comps, 'ligne_id');
    const fraisByDevis = byDevis(frais);

    // 3) Devis (créé une seule fois par numéro).
    let devisCount = 0, lineCount = 0, skipped = 0;
    for (const d of devis) {
      const numero = d.numero || `IMP-${d.id}`;
      // affaire : lien affaire_devis, sinon affaire propre (code = numéro).
      let affaireId = devisAffaire.get(d.id);
      if (!affaireId) affaireId = await ensureAffaire(numero, d.titre || numero, clientMap.get(d.client_id) ?? null, 'en_cours', 0);

      const exists = (await c.query(`SELECT id FROM devis WHERE tenant_id=$1 AND affaire_id=$2 AND numero=$3 LIMIT 1`,
        [tenantId, affaireId, numero])).rows[0];
      if (exists) { skipped++; continue; }

      const status = DEVIS_STATUS[d.statut] || 'open';
      const sortOrder = (await c.query(`SELECT COALESCE(MAX(sort_order),-1)+1 n FROM devis WHERE affaire_id=$1`, [affaireId])).rows[0].n;
      const dv = (await c.query(
        `INSERT INTO devis (tenant_id, affaire_id, numero, designation, type, status, sort_order)
         VALUES ($1,$2,$3,$4,'principal',$5,$6) RETURNING id`,
        [tenantId, affaireId, numero, (d.titre || numero).slice(0, 255), status, sortOrder],
      )).rows[0];
      const version = (await c.query(
        `INSERT INTO devis_version (tenant_id, devis_id, version_no, label) VALUES ($1,$2,1,'v1') RETURNING id`,
        [tenantId, dv.id],
      )).rows[0];

      // Titres (lots) : hiérarchie reconstruite par niveau (pile).
      const lotLine = new Map(); // menges lot id → our line id
      const stack = []; // { niveau, lineId }
      let sort = 0;
      for (const lot of (lotsByDevis.get(d.id) ?? [])) {
        const niveau = lot.niveau || 1;
        while (stack.length && stack[stack.length - 1].niveau >= niveau) stack.pop();
        const parentId = stack.length ? stack[stack.length - 1].lineId : null;
        const line = (await c.query(
          `INSERT INTO devis_line (tenant_id, devis_version_id, parent_line_id, type, code, designation, sort_order, vendable)
           VALUES ($1,$2,$3,'titre',$4,$5,$6,true) RETURNING id`,
          [tenantId, version.id, parentId, lot.num_custom || null, lot.nom || 'Lot', sort++],
        )).rows[0];
        lotLine.set(lot.id, line.id);
        stack.push({ niveau, lineId: line.id });
      }

      // Ouvrages (lignes) sous leur lot, avec PV forcé + sous-détail.
      for (const lg of (lignesByDevis.get(d.id) ?? [])) {
        const parentId = lg.lot_id != null ? lotLine.get(lg.lot_id) ?? null : null;
        const pv = num(lg.prix_unitaire_ht);
        const line = (await c.query(
          `INSERT INTO devis_line
             (tenant_id, devis_version_id, parent_line_id, type, code, designation, unit, quantity, pu,
              pu_vente, pu_vente_force, sort_order, vendable)
           VALUES ($1,$2,$3,'ouvrage',$4,$5,$6,$7,$8,$9,$10,$11,true) RETURNING id`,
          [tenantId, version.id, parentId, lg.num_custom || null, lg.designation || 'Ouvrage',
            lg.unite || 'U', num(lg.quantite) || 1, num(lg.debours_unitaire), pv > 0 ? pv : null, pv > 0, sort++],
        )).rows[0];
        lineCount++;
        // Sous-détail (composants) → ressources enfants.
        let cSort = 0;
        for (const cp of (compsByLigne.get(lg.id) ?? [])) {
          await c.query(
            `INSERT INTO devis_line
               (tenant_id, devis_version_id, parent_line_id, type, code, designation, unit, quantity, perte, pu, nature, sort_order, vendable)
             VALUES ($1,$2,$3,'ressource',$4,$5,$6,$7,$8,$9,$10,$11,true)`,
            [tenantId, version.id, line.id, cp.code || null, cp.designation || 'Ressource',
              cp.unite || 'U', num(cp.ratio) || 1, num(cp.perte), num(cp.pu_debours), NATURE[cp.type] || 'material', cSort++],
          );
        }
      }

      // Coefficients (feuille de vente) depuis taux_par_type ou global.
      let byNature = { labor: null, material: null, equipment: null, subcontract: null };
      let tpt = null;
      try { tpt = d.taux_par_type ? JSON.parse(d.taux_par_type) : null; } catch { tpt = null; }
      const CODE_NAT = { MO: 'labor', M: 'material', MAT: 'equipment', ST: 'subcontract' };
      if (Array.isArray(tpt)) for (const e of tpt) {
        const nat = CODE_NAT[e.code]; if (nat) byNature[nat] = { tauxFg: String(num(e.taux_fg)), tauxBenefice: String(num(e.taux_benefice)) };
      }
      const gFg = String(num(d.taux_fg)), gBen = String(num(d.taux_benefice));
      for (const n of Object.keys(byNature)) if (!byNature[n]) byNature[n] = { tauxFg: gFg, tauxBenefice: gBen };
      await c.query(
        `INSERT INTO sale_sheet (tenant_id, devis_version_id, coefficients, tva_rate, remise_type, remise_valeur)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, version.id, JSON.stringify(byNature), (num(d.tva_globale) / 100).toFixed(4),
          d.remise_type === 'fixe' ? 'fixe' : 'pct', num(d.remise_globale).toFixed(4)],
      );

      // Frais annexes.
      let fSort = 0;
      for (const f of (fraisByDevis.get(d.id) ?? [])) {
        await c.query(
          `INSERT INTO devis_frais_annexe (tenant_id, devis_version_id, designation, type, valeur, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, version.id, f.designation || 'Frais', f.type === 'fixe' ? 'fixe' : 'pct', num(f.valeur).toFixed(4), fSort++],
        );
      }
      devisCount++;
    }
    console.log(`✔ ${devisCount} devis créés (${skipped} déjà présents), ${lineCount} ouvrages`);
    console.log('Terminé (migration opérations).');
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('ÉCHEC:', e.message); process.exit(1); });
