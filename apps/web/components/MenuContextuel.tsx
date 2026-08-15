'use client';

import { useEffect, useRef } from 'react';

export interface EntreeMenu {
  label: string;
  icone?: React.ReactNode;
  onClick: () => void;
  /** Action destructive : détachée du reste et signalée en rouge. */
  danger?: boolean;
  disabled?: boolean;
  /** Trait de séparation AVANT cette entrée. */
  separateurAvant?: boolean;
}

/**
 * Menu contextuel (clic droit) — le geste attendu dans un agenda.
 *
 * Un calendrier où l'on ne peut qu'observer oblige à remonter à un formulaire pour la moindre
 * correction. Ici, on ouvre le menu là où l'on regarde : sur un jour pour y ajouter des heures ou
 * une absence, sur une intervention pour la modifier ou la retirer.
 */
export function MenuContextuel({
  x,
  y,
  titre,
  entrees,
  onFermer,
}: {
  x: number;
  y: number;
  titre?: string;
  entrees: EntreeMenu[];
  onFermer: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dehors = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onFermer();
    };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') onFermer(); };
    // `capture` : le menu doit se fermer avant qu'un clic n'active ce qu'il recouvre.
    document.addEventListener('mousedown', dehors, true);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', dehors, true);
      document.removeEventListener('keydown', echap);
    };
  }, [onFermer]);

  // Sans ce recadrage, un clic droit en bas de page ouvre le menu hors de l'écran.
  const largeur = 232;
  const hauteur = 42 + entrees.length * 32;
  const gauche = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - largeur - 8);
  const haut = Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 800) - hauteur - 8);

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed', left: Math.max(8, gauche), top: Math.max(8, haut), width: largeur,
        background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 8,
        boxShadow: '0 8px 28px rgba(15, 23, 42, .16)', padding: 4, zIndex: 1000,
      }}
    >
      {titre && (
        <div className="muted" style={{
          fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase',
          padding: '6px 8px 7px', borderBottom: '1px solid var(--border)', marginBottom: 4,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {titre}
        </div>
      )}
      {entrees.map((e, i) => (
        <button
          key={`${e.label}-${i}`}
          type="button"
          role="menuitem"
          disabled={e.disabled}
          onClick={() => { e.onClick(); onFermer(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '7px 8px', border: 'none', borderRadius: 6, background: 'transparent',
            font: 'inherit', fontSize: 12, textAlign: 'left',
            color: e.disabled ? 'var(--muted)' : e.danger ? 'var(--danger, #dc2626)' : 'inherit',
            cursor: e.disabled ? 'not-allowed' : 'pointer',
            marginTop: e.separateurAvant ? 5 : 0,
            borderTop: e.separateurAvant ? '1px solid var(--border)' : undefined,
            paddingTop: e.separateurAvant ? 9 : 7,
            opacity: e.disabled ? 0.6 : 1,
          }}
          onMouseEnter={(ev) => {
            if (!e.disabled) ev.currentTarget.style.background = 'var(--surface)';
          }}
          onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent'; }}
        >
          {e.icone}
          {e.label}
        </button>
      ))}
    </div>
  );
}
