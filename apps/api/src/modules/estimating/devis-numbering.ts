/**
 * Numérotation hiérarchique du montage de devis (titre / sous-titre / ouvrage) — convention
 * CHIFFRAGE validée : dans une section, les **ouvrages ET les sous-sections partagent le même
 * compteur**, dans l'ordre du montage (sort_order).
 *
 *   Titre 1
 *     1.1  Ouvrage
 *     1.2  Ouvrage
 *     1.3  Sous-titre        ← continue le compteur du parent
 *       1.3.1 Ouvrage
 *
 * Un numéro personnalisé (`num_custom`) sur un titre/sous-titre remplace le numéro automatique
 * ET sert de préfixe à ses descendants (ex. « LOT 17 » → « LOT 17.1 »). Les lignes de texte et
 * les ressources (sous-détail d'un ouvrage) ne sont pas numérotées.
 *
 * Moteur PUR (sans base) : unique source de vérité réutilisée par le débours, le devis client
 * et le PDF.
 */

export interface NumberingLine {
  id: string;
  parent_line_id: string | null;
  type: string; // titre | sous_titre | ouvrage | ressource | texte
  sort_order: number;
  num_custom?: string | null;
}

/** Types qui reçoivent un numéro (et partagent le compteur de leur parent). */
const NUMBERABLE = new Set(['titre', 'sous_titre', 'ouvrage']);
/** Types dans lesquels on descend pour numéroter les enfants. */
const RECURSE = new Set(['titre', 'sous_titre']);

export function computeLineNumbers(lines: NumberingLine[]): Map<string, string> {
  const byParent = new Map<string | null, NumberingLine[]>();
  for (const l of lines) {
    const k = l.parent_line_id ?? null;
    const arr = byParent.get(k);
    if (arr) arr.push(l);
    else byParent.set(k, [l]);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const result = new Map<string, string>();
  const walk = (parentId: string | null, prefix: string): void => {
    const children = byParent.get(parentId) ?? [];
    let counter = 0;
    for (const c of children) {
      if (!NUMBERABLE.has(c.type)) continue; // texte / ressource → pas de numéro
      counter += 1;
      const auto = prefix ? `${prefix}.${counter}` : `${counter}`;
      const num = c.num_custom && c.num_custom.trim() ? c.num_custom.trim() : auto;
      result.set(c.id, num);
      if (RECURSE.has(c.type)) walk(c.id, num);
    }
  };
  walk(null, '');
  return result;
}
