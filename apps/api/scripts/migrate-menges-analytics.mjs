// Incrément 1b — rattache les ressources de la bibliothèque MENARA au plan analytique
// (lot → famille → code analytique) et aux fournisseurs, depuis MENGES (menara.db).
//
// Le plan analytique MENARA est ISOLÉ et préfixé `MNR-` : dans MENGES un même code peut
// appartenir à plusieurs familles, et le plan pré-existant du tenant demo est divergent —
// réutiliser ses codes classerait mal les ressources. On construit donc un plan propre,
// chaque code sous sa famille DOMINANTE MENGES. Idempotent, non destructif.
//
// Usage : node scripts/migrate-menges-analytics.mjs [chemin_menara.db]
import { execFileSync } from 'node:child_process';
import pglib from '../node_modules/pg/lib/index.js';

const SQLITE_DB = process.argv[2] || '/Users/menco/Desktop/Projets/MENARA/database/menara.db';
const PG = { host: 'localhost', port: 5432, user: 'erp', password: 'erp', database: 'erp_btp' };
const TENANT_SLUG = 'demo';
const LIB_CODE = 'MENARA';
const NATURE = { M: 'material', MO: 'labor', ST: 'subcontract', MAT: 'equipment' };
// Préfixe de famille MENGES → lot métier (niveau que MENGES n'a pas ; éditable ensuite).
const LOT_LABEL = { CH: 'Gros œuvre', P: 'Peinture', SD: 'Revêtements sols durs', SS: 'Revêtements sols souples' };

function sqlite(sql) {
  const out = execFileSync('sqlite3', ['-json', SQLITE_DB, sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : [];
}
const slug = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function main() {
  const rows = sqlite(`SELECT code, type, famille, code_analytique, fournisseur, ref_fournisseur
    FROM ressources ORDER BY id`);
  const c = new pglib.Client(PG);
  await c.connect();
  try {
    const tenantId = (await c.query(`SELECT id FROM tenant WHERE slug=$1`, [TENANT_SLUG])).rows[0].id;
    await c.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
    const libraryId = (await c.query(`SELECT id FROM library WHERE tenant_id=$1 AND code=$2`, [tenantId, LIB_CODE])).rows[0].id;

    // Famille DOMINANTE par code, et nature dominante par famille (depuis MENGES).
    const famCount = new Map(); // codeAna → Map(famille → n)
    const natCount = new Map(); // famille → Map(nature → n)
    for (const r of rows) {
      const codeAna = r.code_analytique && String(r.code_analytique).trim();
      const fam = r.famille && String(r.famille).trim();
      const nat = NATURE[r.type] || 'material';
      if (codeAna && fam) {
        if (!famCount.has(codeAna)) famCount.set(codeAna, new Map());
        const m = famCount.get(codeAna); m.set(fam, (m.get(fam) || 0) + 1);
      }
      if (fam) {
        if (!natCount.has(fam)) natCount.set(fam, new Map());
        const m = natCount.get(fam); m.set(nat, (m.get(nat) || 0) + 1);
      }
    }
    const dominant = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const domFamille = (codeAna) => (famCount.has(codeAna) ? dominant(famCount.get(codeAna)) : null);
    const famNature = (fam) => (natCount.has(fam) ? dominant(natCount.get(fam)) : 'material');

    // Plan analytique MENARA isolé (préfixe MNR-). Caches par code MENGES.
    const lotByPrefix = new Map();  // prefix → lot uuid
    const familleById = new Map();  // famille MENGES → { id }
    const codeById = new Map();     // code MENGES → { id, famille_id }

    const ensureLot = async (prefix, nature) => {
      if (lotByPrefix.has(prefix)) return lotByPrefix.get(prefix);
      const code = `MNR-LOT-${prefix}`;
      const ex = (await c.query(`SELECT id FROM analytical_lot WHERE tenant_id=$1 AND code=$2`, [tenantId, code])).rows[0];
      const id = ex?.id ?? (await c.query(
        `INSERT INTO analytical_lot (tenant_id, nature, code, label) VALUES ($1,$2,$3,$4) RETURNING id`,
        [tenantId, nature, code, LOT_LABEL[prefix] || `MENARA — ${prefix}`],
      )).rows[0].id;
      lotByPrefix.set(prefix, id);
      return id;
    };

    const ensureFamille = async (famille) => {
      if (familleById.has(famille)) return familleById.get(famille).id;
      const nature = famNature(famille);
      const prefix = famille.split('_')[0];
      const lotId = await ensureLot(prefix, nature);
      const code = `MNR-${famille}`;
      const ex = (await c.query(`SELECT id FROM analytical_famille WHERE tenant_id=$1 AND code=$2`, [tenantId, code])).rows[0];
      const id = ex?.id ?? (await c.query(
        `INSERT INTO analytical_famille (tenant_id, lot_id, code, label, nature) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tenantId, lotId, code, (LOT_LABEL[prefix] ? `${LOT_LABEL[prefix]} — ` : '') + famille, nature],
      )).rows[0].id;
      familleById.set(famille, { id });
      return id;
    };

    const ensureCode = async (codeAna, nature) => {
      if (codeById.has(codeAna)) return codeById.get(codeAna);
      const famille = domFamille(codeAna);
      const familleId = await ensureFamille(famille || `X-${nature}`);
      const code = `MNR-${codeAna}`;
      const ex = (await c.query(`SELECT id, famille_id FROM analytical_code WHERE tenant_id=$1 AND code=$2`, [tenantId, code])).rows[0];
      const id = ex?.id ?? (await c.query(
        `INSERT INTO analytical_code (tenant_id, famille_id, code, label, nature) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tenantId, familleId, code, `${codeAna} — ${famille || ''}`.trim(), nature],
      )).rows[0].id;
      const rec = { id, famille_id: ex?.famille_id ?? familleId };
      codeById.set(codeAna, rec);
      return rec;
    };

    // Fournisseurs — upsert par nom (idempotent).
    const supplierByName = new Map((await c.query(`SELECT name, id FROM supplier WHERE tenant_id=$1`, [tenantId])).rows.map((r) => [r.name, r.id]));
    const ensureSupplier = async (name) => {
      if (!name) return null;
      if (supplierByName.has(name)) return supplierByName.get(name);
      const id = (await c.query(
        `INSERT INTO supplier (tenant_id, code, name) VALUES ($1,$2,$3) RETURNING id`,
        [tenantId, slug(name) || `F-${supplierByName.size + 1}`, name],
      )).rows[0].id;
      supplierByName.set(name, id);
      return id;
    };

    let linkedCode = 0, linkedSup = 0;
    const createdSup0 = supplierByName.size;
    for (const r of rows) {
      const nature = NATURE[r.type] || 'material';
      const resCode = (r.code && String(r.code).trim()) || null;
      if (!resCode) continue;
      let codeAnaId = null;
      const codeAna = r.code_analytique && String(r.code_analytique).trim();
      if (codeAna) codeAnaId = (await ensureCode(codeAna, nature)).id;
      const supplierId = await ensureSupplier(r.fournisseur && String(r.fournisseur).trim());
      // code_analytique_id écrasé (SET) pour corriger un éventuel lien erroné d'un run précédent ;
      // la famille est dérivée du code (pas de colonne famille sur resource).
      const upd = await c.query(
        `UPDATE resource SET
           code_analytique_id = COALESCE($3, code_analytique_id),
           supplier_id = COALESCE($4, supplier_id),
           ref_fournisseur = COALESCE($5, ref_fournisseur),
           updated_at = now()
         WHERE tenant_id=$1 AND library_id=$2 AND code=$6`,
        [tenantId, libraryId, codeAnaId, supplierId,
          r.ref_fournisseur ? String(r.ref_fournisseur).slice(0, 128) : null, resCode],
      );
      if (upd.rowCount) {
        if (codeAnaId) linkedCode++;
        if (supplierId) linkedSup++;
      }
    }
    const totalSup = (await c.query(`SELECT count(*)::int n FROM supplier WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    console.log(`✔ ressources rattachées : ${linkedCode} au code analytique, ${linkedSup} à un fournisseur`);
    console.log(`✔ plan MENARA : ${lotByPrefix.size} lots, ${familleById.size} familles, ${codeById.size} codes (préfixe MNR-)`);
    console.log(`✔ fournisseurs créés : ${supplierByName.size - createdSup0} (total tenant : ${totalSup})`);
    console.log('Terminé (incrément 1b).');
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('ÉCHEC:', e.message); process.exit(1); });
