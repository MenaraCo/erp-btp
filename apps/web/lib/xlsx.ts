// Générateur .xlsx minimal, sans dépendance (un seul onglet, ZIP « stored » sans compression).
// Excel lit parfaitement un ZIP non compressé. Évite d'ajouter une lib lourde (SheetJS ~7 Mo).

const enc = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Nom de colonne Excel à partir d'un index 0-based (0→A, 25→Z, 26→AA). */
function colName(n: number): string {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sheetXml(rows: (string | number)[][]): string {
  const rowsXml = rows
    .map((row, ri) => {
      const cells = row
        .map((val, ci) => {
          const ref = `${colName(ci)}${ri + 1}`;
          if (typeof val === 'number' && Number.isFinite(val)) {
            return `<c r="${ref}"><v>${val}</v></c>`;
          }
          const s = escapeXml(String(val ?? ''));
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${s}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
}

interface ZipEntry { name: string; data: Uint8Array }

function concat(arrs: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

const u16 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
const u32 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);

/** Construit un ZIP « stored » (méthode 0) à partir d'entrées de fichiers. */
function buildZip(entries: ZipEntry[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const lh = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0),
      nameBytes, e.data,
    ]);
    local.push(lh);
    const ch = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]);
    central.push(ch);
    offset += lh.length;
  }
  const centralData = concat(central);
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralData.length), u32(offset), u16(0),
  ]);
  return concat([...local, centralData, eocd]);
}

/** Génère le classeur .xlsx (un onglet) et déclenche son téléchargement. */
export function downloadXlsx(filename: string, rows: (string | number)[][], sheetName = 'Feuille1'): void {
  const safeSheet = escapeXml(sheetName.slice(0, 31));
  const files: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml(rows)) },
  ];
  const zip = buildZip(files);
  const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─────────── Mise en forme ───────────
 * Un classeur .xlsx stylé sans dépendance : catalogue de styles FIXE (une entrée par usage),
 * écrit dans styles.xml. Les couleurs de la société sont injectées à la génération, comme
 * pour le PDF, pour que les deux éditions se ressemblent.
 */

/** Usages prévus. Ajouter un style = l'ajouter ici ET dans stylesXml(), dans le MÊME ordre. */
export type StyleKey =
  | 'title' | 'subtitle' | 'label' | 'value'
  | 'header' | 'group1' | 'group2' | 'text' | 'num' | 'unit'
  | 'qty' | 'money' | 'moneyBold' | 'totalLabel' | 'totalMoney' | 'fill';

const STYLE_ORDER: StyleKey[] = [
  'title', 'subtitle', 'label', 'value',
  'header', 'group1', 'group2', 'text', 'num', 'unit',
  'qty', 'money', 'moneyBold', 'totalLabel', 'totalMoney', 'fill',
];
/** Index dans cellXfs : 0 = style par défaut, puis le catalogue dans l'ordre ci-dessus. */
const styleId = (k?: StyleKey) => (k ? STYLE_ORDER.indexOf(k) + 1 : 0);

export interface StyledCell {
  v: string | number | null;
  s?: StyleKey;
  /**
   * Formule Excel, SANS le « = » (ex. `ROUND(D12*E12,2)`). Le classeur se recalcule alors tout
   * seul : changer une quantité mets à jour montants, sous-totaux et totaux. `v` sert de valeur
   * en cache, affichée par les lecteurs qui ne recalculent pas à l'ouverture.
   */
  f?: string;
}
export type SheetCell = string | number | null | StyledCell;

export interface SheetOptions {
  sheetName?: string;
  /** Largeur des colonnes, en caractères (une entrée par colonne, dans l'ordre). */
  cols?: number[];
  /** Fusions, en notation Excel : 'A1:F1'. */
  merges?: string[];
  /** Nombre de lignes figées en haut (l'en-tête reste visible au défilement). */
  freezeRows?: number;
  /** Couleurs de la société (hex avec ou sans #). */
  theme?: { primary?: string; accent?: string };
}

const hex = (c: string | undefined, fallback: string) =>
  (c ?? fallback).replace('#', '').toUpperCase().slice(0, 6).padStart(6, '0');

/** Éclaircit une couleur (mélange avec du blanc) — pour les fonds de titres. */
function lighten(h: string, ratio: number): string {
  const n = parseInt(h, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * ratio);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return ((r << 16) | (g << 8) | b).toString(16).toUpperCase().padStart(6, '0');
}

function stylesXml(theme?: SheetOptions['theme']): string {
  const primary = hex(theme?.primary, '1A3A5C');
  const accent = hex(theme?.accent, 'E8550A');
  const soft = lighten(primary, 0.88);
  const line = lighten(primary, 0.7);

  // numFmt 164 : montants « 1 234,56 € » ; 165 : quantités à 3 décimales, zéro masqué.
  const numFmts = `<numFmts count="2">`
    + `<numFmt numFmtId="164" formatCode="#,##0.00\ &quot;€&quot;;-#,##0.00\ &quot;€&quot;;&quot;&quot;"/>`
    + `<numFmt numFmtId="165" formatCode="#,##0.###;-#,##0.###;&quot;&quot;"/>`
    + `</numFmts>`;

  // 0 normal · 1 gras · 2 titre · 3 gris · 4 blanc gras · 5 gras couleur société
  const fonts = `<fonts count="6">`
    + `<font><sz val="10"/><name val="Calibri"/></font>`
    + `<font><b/><sz val="10"/><name val="Calibri"/></font>`
    + `<font><b/><sz val="16"/><color rgb="FF${primary}"/><name val="Calibri"/></font>`
    + `<font><sz val="9"/><color rgb="FF7C8CA0"/><name val="Calibri"/></font>`
    + `<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>`
    + `<font><b/><sz val="10"/><color rgb="FF${primary}"/><name val="Calibri"/></font>`
    + `</fonts>`;

  // 0 et 1 sont réservés par le format ; les nôtres commencent à 2.
  const fills = `<fills count="5">`
    + `<fill><patternFill patternType="none"/></fill>`
    + `<fill><patternFill patternType="gray125"/></fill>`
    + `<fill><patternFill patternType="solid"><fgColor rgb="FF${primary}"/><bgColor indexed="64"/></patternFill></fill>`
    + `<fill><patternFill patternType="solid"><fgColor rgb="FF${soft}"/><bgColor indexed="64"/></patternFill></fill>`
    + `<fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FC"/><bgColor indexed="64"/></patternFill></fill>`
    + `</fills>`;

  // 0 aucun · 1 cadre complet · 2 filet bas · 3 filet haut (totaux)
  const b = `<left style="thin"><color rgb="FF${line}"/></left><right style="thin"><color rgb="FF${line}"/></right>`
    + `<top style="thin"><color rgb="FF${line}"/></top><bottom style="thin"><color rgb="FF${line}"/></bottom>`;
  const borders = `<borders count="4">`
    + `<border><left/><right/><top/><bottom/></border>`
    + `<border>${b}</border>`
    + `<border><left/><right/><top/><bottom style="thin"><color rgb="FF${line}"/></bottom></border>`
    + `<border><left/><right/><top style="medium"><color rgb="FF${primary}"/></top><bottom/></border>`
    + `</borders>`;

  const xf = (o: {
    font?: number; fill?: number; border?: number; fmt?: number;
    h?: 'left' | 'center' | 'right'; wrap?: boolean;
  }) =>
    `<xf numFmtId="${o.fmt ?? 0}" fontId="${o.font ?? 0}" fillId="${o.fill ?? 0}" borderId="${o.border ?? 0}"`
    + ` applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">`
    + `<alignment horizontal="${o.h ?? 'general'}" vertical="center"${o.wrap ? ' wrapText="1"' : ''}/></xf>`;

  // MÊME ORDRE que STYLE_ORDER (index 0 = style par défaut).
  const cellXfs = [
    xf({}),
    xf({ font: 2 }),                                        // title
    xf({ font: 3 }),                                        // subtitle
    xf({ font: 3, h: 'left' }),                             // label
    xf({ font: 1, h: 'left' }),                             // value
    xf({ font: 4, fill: 2, border: 1, h: 'center' }),       // header
    xf({ font: 5, fill: 3, border: 2, h: 'left' }),         // group1
    xf({ font: 1, fill: 4, border: 2, h: 'left' }),         // group2
    xf({ h: 'left', wrap: true }),                          // text
    xf({ h: 'left' }),                                      // num
    xf({ h: 'center' }),                                    // unit
    xf({ fmt: 165, h: 'right' }),                           // qty
    xf({ fmt: 164, h: 'right' }),                           // money
    xf({ fmt: 164, font: 1, h: 'right' }),                  // moneyBold
    xf({ font: 1, border: 3, h: 'right' }),                 // totalLabel
    xf({ fmt: 164, font: 1, border: 3, h: 'right' }),       // totalMoney
    xf({ border: 1 }),                                      // fill (case à remplir)
  ].join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `${numFmts}${fonts}${fills}${borders}`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="${STYLE_ORDER.length + 1}">${cellXfs}</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
    + `</styleSheet>`;
}

function styledSheetXml(rows: SheetCell[][], opts: SheetOptions): string {
  const rowsXml = rows
    .map((row, ri) => {
      const cells = row
        .map((raw, ci) => {
          const cell: StyledCell =
            raw !== null && typeof raw === 'object' ? raw : { v: raw as string | number | null };
          const ref = `${colName(ci)}${ri + 1}`;
          const st = cell.s ? ` s="${styleId(cell.s)}"` : '';
          if (cell.f) {
            const cached =
              typeof cell.v === 'number' && Number.isFinite(cell.v) ? `<v>${cell.v}</v>` : '';
            return `<c r="${ref}"${st}><f>${escapeXml(cell.f)}</f>${cached}</c>`;
          }
          if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
            return `<c r="${ref}"${st}><v>${cell.v}</v></c>`;
          }
          const txt = cell.v == null ? '' : String(cell.v);
          if (txt === '') return st ? `<c r="${ref}"${st}/>` : '';
          return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${escapeXml(txt)}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');

  const freeze = opts.freezeRows
    ? `<sheetViews><sheetView workbookViewId="0" showGridLines="0">`
      + `<pane ySplit="${opts.freezeRows}" topLeftCell="A${opts.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
      + `</sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>`;
  const cols = opts.cols?.length
    ? `<cols>${opts.cols
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';
  const merges = opts.merges?.length
    ? `<mergeCells count="${opts.merges.length}">`
      + opts.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')
      + `</mergeCells>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `${freeze}${cols}<sheetData>${rowsXml}</sheetData>${merges}`
    + `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>`
    + `<pageSetup orientation="portrait" fitToWidth="1" paperSize="9"/>`
    + `</worksheet>`;
}

/** Classeur mis en page (styles, largeurs, fusions) — même esprit que l'édition PDF. */
export function downloadStyledXlsx(
  filename: string,
  rows: SheetCell[][],
  opts: SheetOptions = {},
): void {
  const safeSheet = escapeXml((opts.sheetName ?? 'Feuille1').slice(0, 31));
  const files: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    { name: 'xl/styles.xml', data: enc.encode(stylesXml(opts.theme)) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(styledSheetXml(rows, opts)) },
  ];
  triggerDownload(filename, buildZip(files));
}

function triggerDownload(filename: string, zip: Uint8Array): void {
  const blob = new Blob([zip.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
