/**
 * Ce que le CLIENT voit du devis — miroir de `devis-client-view.ts` côté API (édition PDF).
 *
 * Une ligne de frais (« FP », « FS », « F* ») n'est pas une prestation : son coût est déjà réparti
 * dans les prix des autres lignes. L'afficher, même à zéro, annoncerait au client une prestation
 * qui n'existe pas. Elle disparaît donc de l'écran « Devis client » et de l'aperçu, comme du PDF,
 * et avec elle tout titre qui ne contiendrait qu'elle.
 */
export interface ClientViewLine {
  id: string;
  parent_line_id: string | null;
  type: string;
  vendable?: boolean;
}

const CONTENT_TYPES = new Set(['ouvrage', 'ressource']);
const TITLE_TYPES = new Set(['titre', 'sous_titre']);

/** Identifiants des lignes à montrer au client. */
export function visibleForClient<T extends ClientViewLine>(lines: T[]): Set<string> {
  const childrenOf = new Map<string | null, T[]>();
  for (const l of lines) {
    const key = l.parent_line_id ?? null;
    const arr = childrenOf.get(key);
    if (arr) arr.push(l);
    else childrenOf.set(key, [l]);
  }

  /** Un titre mérite d'être montré s'il contient une prestation vendue ou un texte libre. */
  const hasClientContent = (parentId: string): boolean =>
    (childrenOf.get(parentId) ?? []).some((c) => {
      if (c.type === 'texte') return true;
      if (CONTENT_TYPES.has(c.type)) return c.vendable !== false;
      if (TITLE_TYPES.has(c.type)) return hasClientContent(c.id);
      return false;
    });

  const visible = new Set<string>();
  for (const l of lines) {
    if (l.vendable === false) continue;
    if (TITLE_TYPES.has(l.type) && !hasClientContent(l.id)) continue;
    visible.add(l.id);
  }
  return visible;
}
