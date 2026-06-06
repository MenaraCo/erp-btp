/**
 * Restaure les référentiels manquants (lots / familles / codes analytiques) depuis CHIFFRAGE,
 * puis réaligne la nature des codes par plage de numéro.
 * Idempotent (ON CONFLICT DO NOTHING). Ne touche PAS aux ressources / affaires / devis.
 */
import { execSync } from 'child_process';
import pg from 'pg';

const DB = '/Users/menco/Desktop/CHIFFRAGE/server/chiffrage.db';
const sql = (q) => { const o = execSync(`sqlite3 -json "${DB}" "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim(); return o ? JSON.parse(o) : []; };
const c = new pg.Client({ host: 'localhost', port: 5432, user: 'erp', password: 'erp', database: 'erp_btp' });

const LOTS = [
  ['GO','Gros œuvre'],['CHAR','Charpente'],['COUV','Couverture'],['ETAN','Étanchéité'],
  ['PLOMB','Plomberie'],['ELEC','Électricité'],['CVC','Chauffage / Ventilation / Climatisation'],
  ['MENU','Menuiseries intérieures'],['MENUEXT','Menuiseries extérieures'],['PLAT','Plâtrerie'],
  ['ISOL','Isolation'],['CARRE','Carrelage / Sols durs'],['SOLS','Sols souples'],['PEIN','Peinture'],
  ['CHAP','Chapes'],['FACC','Façade'],['METAL','Serrurerie / Métallerie'],['NETT','Nettoyage'],
  ['VRD','VRD / Aménagements extérieurs'],['DEMO','Démolition / Dépose'],
];

const run = async () => {
  await c.connect();
  const T = (await c.query("SELECT id FROM tenant WHERE slug='demo'")).rows[0].id;
  await c.query(`SET app.current_tenant='${T}'`);

  // 1. Lots (nature='material' — lots de travaux)
  for (const [code, label] of LOTS)
    await c.query(`INSERT INTO analytical_lot (tenant_id,nature,code,label) VALUES ($1,'material',$2,$3) ON CONFLICT (tenant_id,code) DO NOTHING`, [T, code, label]);
  const lots = (await c.query('SELECT id,code FROM analytical_lot WHERE tenant_id=$1', [T])).rows;
  const byLot = Object.fromEntries(lots.map((l) => [l.code, l.id]));
  const fb = lots[0].id;
  const famToLot = (code) => !code ? byLot['CARRE'] : code.startsWith('SD_')||code.startsWith('CH_') ? byLot['CARRE'] : code.startsWith('SS_') ? byLot['SOLS'] : code.startsWith('P_') ? byLot['PEIN'] : (byLot['NETT']||fb);

  // 2. Familles
  const chiFam = sql('SELECT * FROM ref_familles ORDER BY id');
  for (const f of chiFam)
    await c.query(`INSERT INTO analytical_famille (tenant_id,lot_id,code,label) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,code) DO NOTHING`,
      [T, famToLot(f.code) || fb, String(f.code).slice(0,64), f.designation]);
  const fams = (await c.query('SELECT id,code FROM analytical_famille WHERE tenant_id=$1', [T])).rows;
  const byFam = Object.fromEntries(fams.map((f) => [f.code, f.id]));
  const ffb = fams[0].id;
  const codeToFam = (n) => { n = Number(n); return n<200 ? (byFam['CH_MO']||ffb) : n<240 ? (byFam['SD_CAR']||ffb) : n<270 ? (byFam['SS_PVC']||ffb) : n<300 ? (byFam['P_PEIN']||ffb) : ffb; };

  // 3. Codes analytiques
  const chiCodes = sql('SELECT * FROM ref_analytiques ORDER BY id');
  for (const cd of chiCodes)
    await c.query(`INSERT INTO analytical_code (tenant_id,famille_id,code,label) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,code) DO NOTHING`,
      [T, codeToFam(cd.code), String(cd.code).slice(0,64), cd.designation]);

  // 4. Nature par plage de numéro
  const upd = (nat, cond) => c.query(`UPDATE analytical_code SET nature='${nat}' WHERE tenant_id=$1 AND ${cond}`, [T]);
  await upd('labor', "code ~ '^[0-9]+$' AND code::int BETWEEN 100 AND 169");
  await upd('equipment', "code ~ '^[0-9]+$' AND code::int BETWEEN 300 AND 349");
  await upd('subcontract', "code ~ '^[0-9]+$' AND code::int BETWEEN 500 AND 599");
  await upd('material', "code ~ '^[0-9]+$' AND code::int BETWEEN 170 AND 299");
  await c.query("UPDATE analytical_famille SET nature='labor' WHERE tenant_id=$1 AND (code ILIKE 'MO%' OR label ILIKE '%main%oeuvre%')", [T]);

  const cnt = async (t) => (await c.query(`SELECT count(*) FROM ${t} WHERE tenant_id=$1`, [T])).rows[0].count;
  console.log('lots:', await cnt('analytical_lot'), '| familles:', await cnt('analytical_famille'), '| codes:', await cnt('analytical_code'));
  await c.end();
};
run().catch((e) => { console.error('❌', e.message); process.exit(1); });
