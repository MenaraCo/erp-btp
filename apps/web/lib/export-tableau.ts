import { downloadStyledXlsx, SheetCell, StyleKey } from './xlsx';

/**
 * Export Excel d'un tableau d'écran — une seule façon de le faire, pour toute l'application.
 *
 * Chaque écran écrivait son propre en-tête, ses propres largeurs, ses propres styles : cinq
 * exports, cinq mises en page, et le classeur ne ressemblait jamais à l'écran dont il sortait.
 * Ici on décrit ce qu'on exporte — un titre, un sous-titre, des colonnes, des lignes typées — et
 * la mise en forme suit toute seule.
 *
 * Les colonnes de MONTANT sont alignées à droite et formatées en euros ; les lignes de total et de
 * section portent leur poids visuel. C'est ce qui rend un tableau lisible une fois imprimé.
 */
export type AlignementColonne = 'texte' | 'nombre' | 'montant' | 'quantite';

export interface ColonneExport {
  label: string;
  /** Largeur en caractères ; à défaut, déduite du type. */
  largeur?: number;
  type?: AlignementColonne;
}

export interface LigneExport {
  /** Valeurs dans l'ordre des colonnes. `null` laisse la case vide. */
  cellules: Array<string | number | null>;
  /**
   * `section` : une tête de bloc (Charges, Produits…) ; `total` : une ligne de somme ;
   * `sousTotal` : un total intermédiaire ; défaut : une ligne ordinaire.
   */
  genre?: 'normale' | 'section' | 'sousTotal' | 'total';
  /** Décalage visuel, pour rendre une hiérarchie (0, 1, 2…). */
  niveau?: number;
}

export interface ExportTableau {
  /** Nom du fichier, sans extension. La date du jour y est ajoutée. */
  fichier: string;
  titre: string;
  sousTitre?: string;
  colonnes: ColonneExport[];
  lignes: LigneExport[];
  /** Nom de l'onglet dans le classeur. */
  onglet?: string;
}

const LARGEUR_PAR_TYPE: Record<AlignementColonne, number> = {
  texte: 34, nombre: 14, montant: 16, quantite: 14,
};

function styleCellule(type: AlignementColonne | undefined, genre: LigneExport['genre']): StyleKey {
  const total = genre === 'total' || genre === 'sousTotal';
  if (type === 'montant') return total ? 'totalMoney' : 'money';
  if (type === 'quantite' || type === 'nombre') return total ? 'moneyBold' : 'qty';
  if (genre === 'section') return 'group1';
  if (total) return 'totalLabel';
  return 'text';
}

/** Colonne Excel (1 → A, 27 → AA), pour composer les fusions d'en-tête. */
function colonneExcel(index: number): string {
  let n = index;
  let nom = '';
  while (n > 0) {
    const reste = (n - 1) % 26;
    nom = String.fromCharCode(65 + reste) + nom;
    n = Math.floor((n - 1) / 26);
  }
  return nom;
}

export function exporterTableau({
  fichier, titre, sousTitre, colonnes, lignes, onglet,
}: ExportTableau): void {
  const derniere = colonneExcel(Math.max(colonnes.length, 1));
  const rows: SheetCell[][] = [
    [{ v: titre, s: 'title' }],
    [{ v: sousTitre ?? new Date().toLocaleDateString('fr-FR'), s: 'subtitle' }],
    [],
    colonnes.map((c) => ({ v: c.label, s: 'header' as StyleKey })),
  ];

  for (const ligne of lignes) {
    rows.push(
      ligne.cellules.map((valeur, i) => {
        const col = colonnes[i];
        const indent = i === 0 && ligne.niveau ? '   '.repeat(ligne.niveau) : '';
        return {
          v: typeof valeur === 'string' ? `${indent}${valeur}` : valeur,
          s: styleCellule(col?.type, ligne.genre),
        };
      }),
    );
  }

  downloadStyledXlsx(`${fichier}_${new Date().toISOString().slice(0, 10)}`, rows, {
    sheetName: onglet ?? 'Export',
    cols: colonnes.map((c) => c.largeur ?? LARGEUR_PAR_TYPE[c.type ?? 'texte']),
    merges: [`A1:${derniere}1`, `A2:${derniere}2`],
    // L'en-tête reste visible au défilement : un tableau de chantier fait vite cent lignes.
    freezeRows: 4,
  });
}
