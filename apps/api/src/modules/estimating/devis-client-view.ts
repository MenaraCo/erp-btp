/**
 * Ce que le CLIENT voit du devis.
 *
 * Une ligne de frais (`vendable = false`) n'est pas une prestation : son coût est déjà réparti
 * dans les prix des autres lignes par la feuille de vente. La faire figurer au devis — même à
 * zéro — annoncerait au client une prestation qui n'existe pas et invitera it à la discuter.
 * Elle disparaît donc de la vue client, et avec elle tout titre qui ne contiendrait qu'elle.
 *
 * Fonction pure : la même règle sert l'édition PDF, l'aperçu et l'écran « Devis client ».
 */
export interface ClientViewLine {
  id: string;
  parentLineId: string | null;
  type: string;
  /** false = ligne de frais. */
  vendable: boolean;
}

const CONTENT_TYPES = new Set(['ouvrage', 'ressource']);
const TITLE_TYPES = new Set(['titre', 'sous_titre']);

/**
 * Identifiants des lignes à montrer au client. `excluded` permet d'écarter d'entrée les lignes
 * hors devis principal (options et variantes, éditées à part).
 */
export function visibleForClient(
  lines: ClientViewLine[],
  excluded: (line: ClientViewLine) => boolean = () => false,
): Set<string> {
  const childrenOf = new Map<string | null, ClientViewLine[]>();
  for (const l of lines) {
    const key = l.parentLineId ?? null;
    const arr = childrenOf.get(key);
    if (arr) arr.push(l);
    else childrenOf.set(key, [l]);
  }

  /** Un titre mérite d'être imprimé s'il contient une prestation vendue ou un texte libre. */
  const hasClientContent = (parentId: string): boolean =>
    (childrenOf.get(parentId) ?? []).some((c) => {
      if (excluded(c)) return false;
      if (c.type === 'texte') return true;
      if (CONTENT_TYPES.has(c.type)) return c.vendable !== false;
      if (TITLE_TYPES.has(c.type)) return hasClientContent(c.id);
      return false;
    });

  const visible = new Set<string>();
  for (const l of lines) {
    if (excluded(l)) continue;
    if (l.vendable === false) continue;
    if (TITLE_TYPES.has(l.type) && !hasClientContent(l.id)) continue;
    visible.add(l.id);
  }
  return visible;
}
