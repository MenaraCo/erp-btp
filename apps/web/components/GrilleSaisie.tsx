'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

/**
 * Briques COMMUNES des grilles de saisie type tableur.
 *
 * Le déboursé d'une étude et les lignes d'une commande se saisissent de la même façon : filets
 * fins, cellules sans habillage, Entrée qui descend d'une ligne. Ces briques vivent donc ici et
 * non dans un écran : passer d'un module à l'autre ne doit pas demander de réapprendre un geste.
 *
 * L'habillage (bordures, survol, focus) est porté par les classes CSS `.deb-table`, `.sd-row` et
 * `.sd-head` de `globals.css`.
 */

export const CELL_CTR: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

/**
 * Entrée dans une cellule → saute à la même colonne de la ligne suivante (les champs portent
 * `data-cell="<type>:<champ>"`). Le blur de la cellule quittée valide la saisie.
 */
export function focusNextCell(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const cell = e.currentTarget.dataset.cell;
  const root = e.currentTarget.closest('.deb-table');
  if (!cell || !root) { e.currentTarget.blur(); return; }
  const nodes = Array.from(root.querySelectorAll<HTMLInputElement>(`input[data-cell="${cell}"]`));
  const next = nodes[nodes.indexOf(e.currentTarget) + 1];
  if (next) { next.focus(); next.select(); }
  else e.currentTarget.blur();
}

/** Cellule de code : monospace et compacte, comme dans le déboursé. */
export function CodeInput({ value, readOnly, placeholder, title, style, onChange }: {
  value: string | null | undefined; readOnly: boolean; placeholder: string;
  title: string; style?: React.CSSProperties; onChange: (v: string) => void;
}) {
  return (
    <input title={title} placeholder={placeholder} defaultValue={value ?? ''} disabled={readOnly}
      onBlur={(e) => { const next = e.target.value.trim(); if (next !== (value ?? '')) onChange(next); }}
      style={{ fontSize: 11, fontFamily: 'monospace', color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 4px', ...style }} />
  );
}

/** Unité choisie dans le référentiel société ; une valeur hors liste reste affichée. */
export function UnitSelect({ value, token, readOnly, onChange, style }: {
  value: string | null | undefined;
  token: string | null;
  readOnly: boolean;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
}) {
  const { data } = useQuery({
    queryKey: ['params-units'],
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
    queryFn: () => apiFetch<{ id: string; abrev: string; label: string }[]>('/params/units', { token }),
  });
  const units: { id: string; abrev: string; label: string }[] = data ?? [];
  const current = value ?? '';
  const knownAbrevs = new Set(units.map((u) => u.abrev));
  return (
    <select
      value={current}
      disabled={readOnly}
      title="Unité"
      onChange={(e) => onChange(e.target.value)}
      style={{ width: 60, fontSize: 12, padding: '1px 2px', border: '1px solid #e2e8f0', borderRadius: 4, background: '#f8fafc', color: '#475569', textAlign: 'center', flexShrink: 0, ...style }}
    >
      <option value="">—</option>
      {current && !knownAbrevs.has(current) && <option value={current}>{current}</option>}
      {units.map((u) => (
        <option key={u.id} value={u.abrev} title={u.label}>{u.abrev}</option>
      ))}
    </select>
  );
}

/** Petit carré d'action des menus « + » — même geste dans tous les modules. */
export function ActionSquare({ label, title, color, onClick }: {
  label: string; title: string; color: string; onClick: () => void;
}) {
  return (
    <button type="button" title={title} onClick={onClick}
      style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${color}`, background: 'transparent', color, fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0 }}>
      {label}
    </button>
  );
}

/** Bouton ⓘ d'ouverture de la fiche d'une ligne, identique au déboursé. */
export const infoBtn: React.CSSProperties = {
  color: 'var(--primary)', fontSize: 14, padding: '0 4px', lineHeight: 1, flexShrink: 0,
};
