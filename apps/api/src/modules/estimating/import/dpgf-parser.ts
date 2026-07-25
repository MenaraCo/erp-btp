import { XMLParser } from 'fast-xml-parser';
import * as XLSX from 'xlsx';

/**
 * Parseurs DPGF (bordereau) — XML standard d'échange devis et Excel (2 onglets).
 * Produisent une structure normalisée : titres → ouvrages chiffrés (déboursé + PV), sans sous-détail.
 * Fonctions pures (aucun accès base) — testées isolément.
 */
export interface ParsedOuvrage {
  code: string | null;
  designation: string;
  unite: string;
  quantite: number;
  debours: number; // déboursé unitaire
  pv: number; // prix de vente unitaire HT
  tva: number;
}
export interface ParsedLot {
  nom: string;
  ouvrages: ParsedOuvrage[];
}
export interface ParsedDevis {
  numero: string;
  titre: string;
  objet: string | null;
  clientName: string | null;
  lots: ParsedLot[];
}

const num = (v: unknown): number =>
  v == null || v === '' ? 0 : Number(String(v).replace(/\s/g, '').replace(',', '.')) || 0;
const arr = <T>(x: T | T[] | undefined | null): T[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
const first = (x: unknown): string => (Array.isArray(x) ? String(x[0] ?? '') : x == null ? '' : String(x));

// ─────────────────────────── XML (format standard Ligne_Titre / Ligne_Ouvrage) ───────────────────
export function parseDpgfXml(buffer: Buffer): ParsedDevis {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    parseAttributeValue: false,
    parseTagValue: false,
  });
  const doc = parser.parse(buffer.toString('utf8'));
  const rootKey = Object.keys(doc).find((k) => k !== '?xml');
  const root = rootKey ? doc[rootKey] : {};

  const numero = first(root.Code) || 'IMPORT';
  const titre = first(root.Libelle) || numero;
  const objet = first(root.NatureTravaux) || null;
  const client = root.Client;
  const clientName = client ? first(client.RaisonSociale) || first(client.Nom) || null : null;

  const typeOf = (node: Record<string, unknown>): string =>
    String(node['@_xsi:type'] ?? node['@_type'] ?? '');

  const lots: ParsedLot[] = [];
  const walk = (nodes: unknown, path: string): void => {
    for (const node of arr<Record<string, unknown>>(nodes as never)) {
      const t = typeOf(node);
      if (t === 'Ligne_Titre') {
        const titreNode = (node.Titre ?? {}) as Record<string, unknown>;
        const libelle = first(titreNode.Libelle) || first(titreNode.Libelle_Commercial) || 'Section';
        const fullPath = path ? `${path} — ${libelle}` : libelle;
        const contenu = (titreNode.ContenuTitre as Record<string, unknown>)?.Ligne_Document;
        const children = arr<Record<string, unknown>>(contenu as never);
        const ouvrages = children.filter((c) => typeOf(c) === 'Ligne_Ouvrage');
        if (ouvrages.length) lots.push({ nom: fullPath, ouvrages: ouvrages.map(toOuvrage) });
        const subTitres = children.filter((c) => typeOf(c) === 'Ligne_Titre');
        if (subTitres.length) walk(subTitres, fullPath);
      } else if (t === 'Ligne_Ouvrage') {
        const nom = path || 'Divers';
        const lot = lots.find((l) => l.nom === nom) ?? (lots.push({ nom, ouvrages: [] }), lots[lots.length - 1]);
        lot.ouvrages.push(toOuvrage(node));
      }
    }
  };
  const contenuDoc = ((root.Documents as Record<string, unknown>)?.Document as Record<string, unknown>) ?? {};
  const ligneDoc = (contenuDoc.ContenuDocument as Record<string, unknown>)?.Ligne_Document;
  walk(ligneDoc, '');

  return { numero, titre, objet, clientName, lots };
}

function toOuvrage(node: Record<string, unknown>): ParsedOuvrage {
  const o = (node.Ouvrage ?? {}) as Record<string, unknown>;
  const designation = first(o.Libelle_Commercial) || first(o.Libelle) || 'Sans désignation';
  const unite = first((o.Unite as Record<string, unknown>)?.Code) || first(o.Unite) || 'U';
  return {
    code: first(o.Code) || null,
    designation,
    unite,
    quantite: num(first(o.Quantite)) || 1,
    debours: num(first(o.PrixDebourse)),
    pv: num(first(o.PrixVente)),
    tva: num(first(node.TvaTaux)) || 20,
  };
}

// ─────────────────────────── Excel (onglets « Informations » + « Lignes ») ───────────────────────
export function parseDpgfExcel(buffer: Buffer): ParsedDevis {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = (name: string) =>
    wb.Sheets[wb.SheetNames.find((n) => n.toLowerCase().startsWith(name)) ?? ''];

  // Onglet Informations : paires clé/valeur (colonnes A/B) — tolérant.
  const info: Record<string, string> = {};
  const infoSheet = sheet('info');
  if (infoSheet) {
    for (const row of XLSX.utils.sheet_to_json<string[]>(infoSheet, { header: 1, blankrows: false })) {
      if (row?.[0]) info[String(row[0]).trim().toLowerCase()] = String(row[1] ?? '').trim();
    }
  }
  const pick = (...keys: string[]) => keys.map((k) => info[k]).find((v) => v) ?? '';

  // Onglet Lignes : LOT, DÉSIGNATION, QTE, UNITE, PU_HT, DEBOURS_UNITAIRE.
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const lignesSheet = sheet('ligne');
  const rows: Record<string, unknown>[] = lignesSheet
    ? XLSX.utils.sheet_to_json(lignesSheet, { defval: '' })
    : [];
  const lotsMap = new Map<string, ParsedLot>();
  for (const raw of rows) {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) r[norm(k)] = v;
    const designation = String(r['DESIGNATION'] ?? r['LIBELLE'] ?? '').trim();
    if (!designation) continue;
    const lotNom = String(r['LOT'] ?? 'Divers').trim() || 'Divers';
    const lot = lotsMap.get(lotNom) ?? (lotsMap.set(lotNom, { nom: lotNom, ouvrages: [] }), lotsMap.get(lotNom)!);
    lot.ouvrages.push({
      code: (String(r['CODE'] ?? '').trim() || null),
      designation,
      unite: String(r['UNITE'] ?? 'U').trim() || 'U',
      quantite: num(r['QTE'] ?? r['QUANTITE']) || 1,
      debours: num(r['DEBOURSUNITAIRE'] ?? r['DEBOURS']),
      pv: num(r['PUHT'] ?? r['PU'] ?? r['PRIXUNITAIREHT']),
      tva: num(r['TVA'] ?? r['TVATAUX']) || 20,
    });
  }

  return {
    numero: pick('numero', 'numéro', 'code', 'n°') || 'IMPORT',
    titre: pick('titre', 'libelle', 'libellé', 'objet') || 'Devis importé',
    objet: pick('objet', 'nature', 'nature travaux') || null,
    clientName: pick('client', 'raison sociale', 'maitre ouvrage', "maître d'ouvrage") || null,
    lots: [...lotsMap.values()],
  };
}
