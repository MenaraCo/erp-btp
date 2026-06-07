import { execSync } from 'child_process';
import pg from 'pg';
const DB='/Users/menco/Desktop/CHIFFRAGE/server/chiffrage.db';
const sql=(q)=>{const o=execSync(`sqlite3 -json "${DB}" "${q.replace(/"/g,'\\"')}"`,{encoding:'utf8'}).trim();return o?JSON.parse(o):[];};
const c=new pg.Client({host:'localhost',port:5432,user:'erp',password:'erp',database:'erp_btp'});

// 15 codes absents de ref_analytiques : famille + label (depuis la famille) + nature
const MISSING=[
  ['220','SD_ACC','SD_Accessoires'],['221','SD_MOS','SD_Mosaiques'],['222','SD_ACC','SD_Accessoires (finition)'],
  ['248','SS_PVC','SS_Sols souples (accessoires)'],['249','SS_ACC','SS_Sous-couche'],['250','SS_COL_P','SS_Colle parquet'],
  ['251','SS_ACC','SS_Plinthes'],['252','SS_ACC','SS_Sous-couche isolante'],['253','SS_PVC','SS_Cordon de soudure'],
  ['254','SS_ACC','SS_Plinthes PVC'],['282','P_REV','P_Toile de verre (revêtement)'],['283','P_PEIN','P_Peinture (fixateur)'],
  ['284','P_PEIN','P_Peinture impression glycéro'],['285','P_PEIN','P_Diluant / White spirit'],['286','P_ACC','P_Nez de marche'],
];

await c.connect();
const t=(await c.query("SELECT id FROM tenant WHERE slug='demo'")).rows[0].id;
await c.query(`SET app.current_tenant='${t}'`);

const fams=(await c.query('SELECT id,code FROM analytical_famille WHERE tenant_id=$1',[t])).rows;
const byFam=Object.fromEntries(fams.map(f=>[f.code,f.id]));

// 1. upsert des 15 codes (update si existe -> 250, insert sinon)
for(const [code,famCode,label] of MISSING){
  const famId=byFam[famCode]||null;
  await c.query(
    `INSERT INTO analytical_code (tenant_id,famille_id,code,label,nature) VALUES ($1,$2,$3,$4,'material')
     ON CONFLICT (tenant_id,code) DO UPDATE SET famille_id=EXCLUDED.famille_id, label=EXCLUDED.label, nature='material'`,
    [t,famId,code,label]);
}

// 2. re-lier toutes les ressources CHF à leur code analytique
const lib=(await c.query("SELECT id FROM library WHERE tenant_id=$1 AND code='CHF'",[t])).rows[0].id;
const codes=(await c.query('SELECT id,code FROM analytical_code WHERE tenant_id=$1',[t])).rows;
const byCode=Object.fromEntries(codes.map(x=>[String(x.code),x.id]));
const chiRes=sql("SELECT code, code_analytique FROM ressources WHERE code IS NOT NULL AND code!='' AND code NOT IN ('oiui','rezrz')");
const caByResCode=Object.fromEntries(chiRes.map(r=>[r.code,r.code_analytique?String(r.code_analytique):null]));

const demoRes=(await c.query('SELECT id,code FROM resource WHERE tenant_id=$1 AND library_id=$2',[t,lib])).rows;
let linked=0,nullca=0;
for(const r of demoRes){
  const ca=caByResCode[r.code];
  const caId=ca?byCode[ca]:null;
  if(caId){ await c.query('UPDATE resource SET code_analytique_id=$1 WHERE id=$2',[caId,r.id]); linked++; }
  else nullca++;
}
const classified=(await c.query('SELECT count(*) FROM resource WHERE tenant_id=$1 AND library_id=$2 AND code_analytique_id IS NOT NULL',[t,lib])).rows[0].count;
const totalCodes=(await c.query('SELECT count(*) FROM analytical_code WHERE tenant_id=$1',[t])).rows[0].count;
console.log('codes total:',totalCodes,'| ressources re-liées:',linked,'| sans code (vide dans CHIFFRAGE):',nullca,'| classées au final:',classified);
await c.end();
