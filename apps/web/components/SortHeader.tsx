'use client';

/**
 * En-tête de colonne triable réutilisable.
 * Cycle de tri au clic : neutre → croissant (↑) → décroissant (↓) → neutre (reset).
 * Utilisé pour le tri serveur (ressources) comme client (tables de référence).
 */

export interface SortState { key: string | null; dir: 'asc' | 'desc' }

/** Calcule le prochain état de tri quand on clique sur la colonne `key`. */
export function nextSort(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return { key: null, dir: 'asc' }; // reset
}

/** Tri générique d'un tableau d'objets selon l'état (côté client). */
export function applySort<T>(rows: T[], sort: SortState, accessor: (row: T, key: string) => unknown): T[] {
  if (!sort.key) return rows;
  const k = sort.key;
  const sign = sort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = accessor(a, k);
    const vb = accessor(b, k);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const na = Number(va), nb = Number(vb);
    if (!isNaN(na) && !isNaN(nb) && va !== '' && vb !== '') return (na - nb) * sign;
    return String(va).localeCompare(String(vb), 'fr', { numeric: true }) * sign;
  });
}

export function SortHeader({ label, colKey, sort, onSort, right, draggable, onDragStart, onDragOver, onDrop, dragging }: {
  label: string;
  colKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  right?: boolean;
  /** drag & drop pour réordonner les colonnes */
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  dragging?: boolean;
}) {
  const active = sort.key === colKey;
  const arrow = !active ? '↕' : sort.dir === 'asc' ? '↑' : '↓';
  return (
    <th
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={() => onSort(colKey)}
      style={{
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        textAlign: right ? 'right' : 'left',
        opacity: dragging ? 0.4 : 1,
        background: dragging ? 'var(--bg-alt, #f1f5f9)' : undefined,
      }}
      title="Cliquer pour trier · glisser pour déplacer"
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexDirection: right ? 'row-reverse' : 'row' }}>
        {draggable && <span style={{ color: 'var(--muted)', cursor: 'grab', fontSize: 11 }}>⠿</span>}
        {label}
        <span style={{ color: active ? 'var(--accent)' : 'var(--muted)', fontSize: 11, fontWeight: 700 }}>{arrow}</span>
      </span>
    </th>
  );
}
