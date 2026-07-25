import { XMLParser } from 'fast-xml-parser';

/**
 * Parseur de nomenclature XML (bibliothèque MENGES) : matériaux (RESS_MX), tâches MO/ST (TACHE)
 * et ouvrages composés (OUVRAGE + SOUS_DETAIL). Fonction pure — testée isolément.
 *
 * Règles de prix :
 *  - RESS_MX : pu_debours = ENT_PU × (1−REMISE1%) × (1−REMISE2%) ; pu_public = PU_MERCURIALE / ACHAT_FACTEUR.
 *  - TACHE  : pu_debours = ENT_PU ; nature = subcontract si code STP/ST_ ou FAMILLE=ST, sinon labor.
 *  - composant : ratio = QTE_SAISIE, référence par code (REF_RESS_MX / REF_TACHE / REF_OUVRAGE).
 */
export type Nature = 'material' | 'labor' | 'equipment' | 'subcontract';

export interface NomResource {
  code: string;
  designation: string;
  unite: string;
  nature: Nature;
  unitCost: number;
  prixPublic: number | null;
  famille: string | null;
}
export interface NomComposant {
  refCode: string;
  kind: 'resource' | 'sub_ouvrage';
  ratio: number;
}
export interface NomOuvrage {
  code: string;
  designation: string;
  unite: string;
  composants: NomComposant[];
}
export interface ParsedNomenclature {
  resources: NomResource[];
  ouvrages: NomOuvrage[];
}

const num = (v: unknown): number =>
  v == null || v === '' ? 0 : Number(String(v).replace(/\s/g, '').replace(',', '.')) || 0;
const arr = <T>(x: T | T[] | undefined | null): T[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
const val = (x: unknown): string => (Array.isArray(x) ? String(x[0] ?? '') : x == null ? '' : String(x));

function tacheNature(code: string, famille: string): Nature {
  const f = famille.toUpperCase();
  const c = code.toUpperCase();
  return f === 'ST' || c.includes('STP') || c.includes('ST_') ? 'subcontract' : 'labor';
}

export function parseNomenclatureXml(buffer: Buffer): ParsedNomenclature {
  const parser = new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false });
  const doc = parser.parse(buffer.toString('utf8'));
  const root = doc.NOMENCLATURE ?? {};

  const resources: NomResource[] = [];

  // Matériaux (RESS_MX)
  for (const r of arr<Record<string, unknown>>(root?.LES_RESSOURCES?.LES_RESS_MX?.RESS_MX)) {
    const code = val(r.CODE);
    if (!code) continue;
    const entPu = num(val(r.ENT_PU));
    const debours = entPu * (1 - num(val(r.REMISE1)) / 100) * (1 - num(val(r.REMISE2)) / 100);
    const facteur = num(val(r.ACHAT_FACTEUR));
    const prixPublic = facteur > 0 ? num(val(r.PU_MERCURIALE)) / facteur : num(val(r.PU_MERCURIALE));
    resources.push({
      code,
      designation: val(r.TEXTE_COM) || val(r.TEXTE_COURT) || code,
      unite: val(r.UNITE) || 'U',
      nature: 'material',
      unitCost: debours,
      prixPublic: prixPublic || null,
      famille: val(r.FAMILLE) || null,
    });
  }

  // Tâches (MO / sous-traitance)
  for (const t of arr<Record<string, unknown>>(root?.LES_TACHES?.TACHE)) {
    const code = val(t.CODE);
    if (!code) continue;
    resources.push({
      code,
      designation: val(t.TEXTE_COM) || val(t.TEXTE_COURT) || code,
      unite: val(t.UNITE) || 'U',
      nature: tacheNature(code, val(t.FAMILLE)),
      unitCost: num(val(t.ENT_PU)),
      prixPublic: null,
      famille: val(t.FAMILLE) || null,
    });
  }

  // Ouvrages + composition
  const ouvrages: NomOuvrage[] = [];
  for (const o of arr<Record<string, unknown>>(root?.LES_OUVRAGES?.OUVRAGE)) {
    const code = val(o.CODE);
    if (!code) continue;
    const composants: NomComposant[] = [];
    for (const l of arr<Record<string, unknown>>((o.SOUS_DETAIL as Record<string, unknown>)?.LIGNE_SOUS_DETAIL as never)) {
      const ratio = num(val(l.QTE_SAISIE));
      if (l.REF_RESS_MX != null) composants.push({ refCode: val(l.REF_RESS_MX), kind: 'resource', ratio });
      else if (l.REF_TACHE != null) composants.push({ refCode: val(l.REF_TACHE), kind: 'resource', ratio });
      else if (l.REF_OUVRAGE != null) composants.push({ refCode: val(l.REF_OUVRAGE), kind: 'sub_ouvrage', ratio });
    }
    ouvrages.push({
      code,
      designation: val(o.TEXTE_COM) || val(o.TEXTE_COURT) || code,
      unite: val(o.UNITE) || 'U',
      composants,
    });
  }

  return { resources, ouvrages };
}
