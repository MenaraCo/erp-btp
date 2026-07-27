import * as XLSX from 'xlsx';
import { Nature } from './nomenclature-parser';

/**
 * Parseur Excel de ressources (bibliothèque). Colonnes attendues (ordre libre, en-têtes tolérants) :
 * CODE, DÉSIGNATION*, TYPE (M/MO/ST/MAT), UNITE, PU_PUBLIC, PU_DEBOURS, CATEGORIE, FAMILLE,
 * CODE_ANALYTIQUE, FOURNISSEUR, REF_FOURNISSEUR. Fonction pure.
 */
export interface ExcelResource {
  code: string;
  designation: string;
  nature: Nature;
  unite: string;
  puDebours: number;
  prixPublic: number | null;
  famille: string | null;
  codeAnalytique: string | null;
  fournisseur: string | null;
  refFournisseur: string | null;
}

const TYPE_NATURE: Record<string, Nature> = {
  M: 'material', MAT: 'equipment', MO: 'labor', ST: 'subcontract',
  MATERIAU: 'material', MATERIEL: 'equipment', MAINDOEUVRE: 'labor', SOUSTRAITANCE: 'subcontract',
};
const num = (v: unknown): number =>
  v == null || v === '' ? 0 : Number(String(v).replace(/\s/g, '').replace(',', '.')) || 0;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function parseResourcesExcel(buffer: Buffer): ExcelResource[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase().startsWith('ress')) ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const out: ExcelResource[] = [];
  for (const raw of rows) {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) r[norm(k)] = v;
    const designation = String(r['DESIGNATION'] ?? r['LIBELLE'] ?? '').trim();
    const code = String(r['CODE'] ?? '').trim();
    if (!designation && !code) continue;
    const typeKey = norm(String(r['TYPE'] ?? 'M'));
    out.push({
      code: code || designation.slice(0, 40),
      designation: designation || code,
      nature: TYPE_NATURE[typeKey] ?? 'material',
      unite: String(r['UNITE'] ?? r['UNITE'] ?? 'U').trim() || 'U',
      puDebours: num(r['PUDEBOURS'] ?? r['DEBOURS'] ?? r['PUDEBOURSE']),
      prixPublic: r['PUPUBLIC'] !== undefined && r['PUPUBLIC'] !== '' ? num(r['PUPUBLIC']) : null,
      famille: (String(r['FAMILLE'] ?? '').trim() || null),
      codeAnalytique: (String(r['CODEANALYTIQUE'] ?? r['CODEANA'] ?? '').trim() || null),
      fournisseur: (String(r['FOURNISSEUR'] ?? r['DISTRIBUTEUR'] ?? '').trim() || null),
      refFournisseur: (String(r['REFFOURNISSEUR'] ?? '').trim() || null),
    });
  }
  return out;
}
