// Migration MENGES (SQLite menara.db) → notre bibliothèque "MENARA" (tenant demo, Postgres).
// Importe ressources + ouvrages + composants, recalcule le débours. Idempotent (upsert par code).
// NON destructif : n'insère/actualise que la bibliothèque MENARA du tenant demo.
//
// Usage : node scripts/migrate-menges.mjs [chemin_menara.db]
import { execFileSync } from 'node:child_process';
import pglib from '../node_modules/pg/lib/index.js';

const SQLITE_DB = process.argv[2] || '/Users/menco/Desktop/Projets/MENARA/database/menara.db';
const PG = { host: 'localhost', port: 5432, user: 'erp', password: 'erp', database: 'erp_btp' };
const TENANT_SLUG = 'demo';
const LIB_CODE = 'MENARA';
const LIB_NAME = 'Bibliothèque MENARA';

// type MENGES (M/MO/ST/MAT) → nature (contrainte CHECK de resource.nature)
const NATURE = { M: 'material', MO: 'labor', ST: 'subcontract', MAT: 'equipment' };

function sqlite(sql) {
  const out = execFileSync('sqlite3', ['-json', SQLITE_DB, sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : [];
}
const num = (v) => (v == null || v === '' ? 0 : Number(String(v).replace(',', '.')) || 0);

async function main() {
  const ressources = sqlite(`SELECT id, code, designation, type, unite, pu_debours, pu_public, prix_public,
      unite_achat, coeff_conversion, ref_fournisseur, conditionnement, famille, code_analytique
    FROM ressources ORDER BY id`);
  const ouvrages = sqlite(`SELECT id, code, designation, description, unite, categorie FROM ouvrages ORDER BY id`);
  const comps = sqlite(`SELECT ouvrage_id, ref_type, ressource_id, sous_ouvrage_id, ratio, perte, cadence, ordre
    FROM ouvrage_composants ORDER BY ouvrage_id, ordre`);
  console.log(`MENGES: ${ressources.length} ressources, ${ouvrages.length} ouvrages, ${comps.length} composants`);

  const c = new pglib.Client(PG);
  await c.connect();
  try {
    const t = (await c.query(`SELECT id FROM tenant WHERE slug=$1`, [TENANT_SLUG])).rows[0];
    if (!t) throw new Error(`tenant ${TENANT_SLUG} introuvable`);
    const tenantId = t.id;
    // RLS FORCE : se placer dans le tenant pour les INSERT/UPDATE.
    await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

    // 1) Bibliothèque MENARA (upsert par (tenant, code)).
    const lib = (await c.query(
      `INSERT INTO library (tenant_id, code, name, description)
       VALUES ($1,$2,$3,'Importée depuis MENGES (menara.db)')
       ON CONFLICT (tenant_id, code) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      [tenantId, LIB_CODE, LIB_NAME],
    )).rows[0];
    const libraryId = lib.id;

    // 2) Ressources — upsert par (tenant, library, code). Code généré si vide.
    const resUuid = new Map(); // menges resource id → our uuid
    const resCost = new Map(); // our uuid → unit_cost (pour le calcul débours)
    let rCount = 0;
    for (const r of ressources) {
      const code = (r.code && String(r.code).trim()) || `MN-R${r.id}`;
      const nature = NATURE[r.type] || 'material';
      const unit = (r.unite && String(r.unite).trim()) || 'U';
      const unitCost = num(r.pu_debours);
      const prixPublic = r.prix_public != null ? num(r.prix_public) : (r.pu_public != null ? num(r.pu_public) : null);
      const coeff = r.coeff_conversion != null && num(r.coeff_conversion) > 0 ? num(r.coeff_conversion) : 1;
      const row = (await c.query(
        `INSERT INTO resource
           (tenant_id, library_id, code, label, unit, nature, unit_cost,
            prix_public, unite_achat, coeff_conversion, ref_fournisseur, conditionnement)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_id, library_id, code) DO UPDATE SET
           label=EXCLUDED.label, unit=EXCLUDED.unit, nature=EXCLUDED.nature, unit_cost=EXCLUDED.unit_cost,
           prix_public=EXCLUDED.prix_public, unite_achat=EXCLUDED.unite_achat,
           coeff_conversion=EXCLUDED.coeff_conversion, ref_fournisseur=EXCLUDED.ref_fournisseur,
           conditionnement=EXCLUDED.conditionnement, updated_at=now()
         RETURNING id`,
        [tenantId, libraryId, code, r.designation || code, unit.slice(0, 16), nature, unitCost,
          prixPublic, r.unite_achat ? String(r.unite_achat).slice(0, 16) : null, coeff,
          r.ref_fournisseur ? String(r.ref_fournisseur).slice(0, 128) : null,
          r.conditionnement ? String(r.conditionnement).slice(0, 64) : null],
      )).rows[0];
      resUuid.set(r.id, row.id);
      resCost.set(row.id, unitCost);
      rCount++;
    }
    console.log(`✔ ${rCount} ressources`);

    // 3) Ouvrages — upsert par (tenant, library, code). Débours recalculé après les composants.
    const ouvUuid = new Map(); // menges ouvrage id → our uuid
    for (const o of ouvrages) {
      const code = (o.code && String(o.code).trim()) || `MN-O${o.id}`;
      const row = (await c.query(
        `INSERT INTO ouvrage (tenant_id, library_id, code, label, unit, debourse, description, categorie)
         VALUES ($1,$2,$3,$4,$5,0,$6,$7)
         ON CONFLICT (tenant_id, library_id, code) DO UPDATE SET
           label=EXCLUDED.label, unit=EXCLUDED.unit, description=EXCLUDED.description,
           categorie=EXCLUDED.categorie, updated_at=now()
         RETURNING id`,
        [tenantId, libraryId, code, o.designation || code, (o.unite || 'U').slice(0, 16),
          o.description || null, o.categorie ? String(o.categorie).slice(0, 128) : null],
      )).rows[0];
      ouvUuid.set(o.id, row.id);
    }
    console.log(`✔ ${ouvrages.length} ouvrages`);

    // 4) Composants — delete puis insert par ouvrage (idempotent).
    const compByOuv = new Map(); // our ouvrage uuid → [{kind, childRes, childOuv, ratio, perte}]
    let cCount = 0, skipped = 0;
    for (const id of ouvUuid.values()) {
      await c.query(`DELETE FROM ouvrage_component WHERE parent_ouvrage_id=$1`, [id]);
      compByOuv.set(id, []);
    }
    for (const comp of comps) {
      const parentId = ouvUuid.get(comp.ouvrage_id);
      if (!parentId) { skipped++; continue; }
      const ratio = num(comp.ratio);
      const perte = num(comp.perte);
      let kind, childRes = null, childOuv = null;
      if (comp.ref_type === 'ouvrage') {
        childOuv = ouvUuid.get(comp.sous_ouvrage_id);
        if (!childOuv) { skipped++; continue; }
        kind = 'sub_ouvrage';
      } else {
        childRes = resUuid.get(comp.ressource_id);
        if (!childRes) { skipped++; continue; }
        kind = 'resource';
      }
      await c.query(
        `INSERT INTO ouvrage_component
           (tenant_id, parent_ouvrage_id, kind, child_resource_id, child_ouvrage_id, quantity, perte, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId, parentId, kind, childRes, childOuv, ratio, perte, comp.ordre || 0],
      );
      compByOuv.get(parentId).push({ kind, childRes, childOuv, ratio, perte });
      cCount++;
    }
    console.log(`✔ ${cCount} composants (${skipped} ignorés : référence introuvable)`);

    // 5) Débours ouvrage = Σ ratio×(1+perte/100)×débours(composant), récursif sur sous-ouvrages.
    const debCache = new Map();
    const debours = (ouvId, seen = new Set()) => {
      if (debCache.has(ouvId)) return debCache.get(ouvId);
      if (seen.has(ouvId)) return 0; // anti-cycle
      seen.add(ouvId);
      let sum = 0;
      for (const k of compByOuv.get(ouvId) || []) {
        const eff = k.ratio * (1 + k.perte / 100);
        sum += eff * (k.kind === 'resource' ? (resCost.get(k.childRes) || 0) : debours(k.childOuv, new Set(seen)));
      }
      debCache.set(ouvId, sum);
      return sum;
    };
    for (const id of ouvUuid.values()) {
      await c.query(`UPDATE ouvrage SET debourse=$2, updated_at=now() WHERE id=$1`,
        [id, debours(id).toFixed(4)]);
    }
    console.log(`✔ débours recalculé sur ${ouvUuid.size} ouvrages`);
    console.log(`\nTerminé. Bibliothèque "${LIB_NAME}" (${LIB_CODE}) — tenant ${TENANT_SLUG}.`);
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error('ÉCHEC:', e.message); process.exit(1); });
