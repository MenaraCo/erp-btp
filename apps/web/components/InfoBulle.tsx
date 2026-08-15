'use client';

import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/**
 * Petit « ⓘ » cliquable qui révèle un détail à la demande.
 *
 * Sert à ALLÉGER les écrans de choix : la composition d'un palier ou la description d'un module
 * n'a pas besoin d'occuper la page en permanence — elle n'intéresse qu'au moment du doute. Le
 * chiffre qui sert à décider (prix, jetons) reste, lui, toujours visible.
 *
 * Ouverture au clic (et non au survol) : sur tablette, un survol n'existe pas — or ces écrans
 * sont utilisés sur le terrain. Se referme au clic ailleurs ou par Échap.
 */
export function InfoBulle({
  children,
  label = 'Voir le détail',
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const clicAilleurs = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', clicAilleurs);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', clicAilleurs);
      document.removeEventListener('keydown', echap);
    };
  }, [open]);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: '50%', cursor: 'pointer',
          border: '1px solid var(--border)',
          background: open ? 'var(--primary)' : 'transparent',
          color: open ? '#fff' : 'var(--muted)',
          padding: 0,
        }}
      >
        <Info size={13} />
      </button>

      {open && (
        <span
          role="dialog"
          style={{
            position: 'absolute', top: 26, right: 0, zIndex: 30, width: 260,
            background: 'var(--surface, #fff)', color: 'var(--text, inherit)',
            border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px',
            boxShadow: '0 6px 20px rgba(15, 23, 42, 0.16)',
            fontSize: 11.5, lineHeight: 1.5, textAlign: 'left', fontWeight: 400,
            whiteSpace: 'normal',
          }}
        >
          {children}
        </span>
      )}
    </span>
  );
}
