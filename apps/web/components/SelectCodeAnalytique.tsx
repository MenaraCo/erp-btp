'use client';

import { useEffect, useRef, useState } from 'react';

export interface CodeAnalytique {
  id: string;
  code: string;
  label: string;
}

/**
 * Choix d'un code analytique — replié, il n'affiche QUE le code.
 *
 * Un intitulé complet (« 281 — Adhésif peinture ») mange la moitié d'une ligne de commande pour
 * une information qu'on connaît par cœur une fois le code lu. Le déroulé, lui, montre code ET
 * intitulé : c'est au moment de CHOISIR qu'on a besoin du libellé, pas au moment de relire.
 *
 * Un `<select>` natif ne sait pas afficher deux textes différents selon qu'il est ouvert ou
 * fermé — d'où ce composant.
 */
export function SelectCodeAnalytique({
  valeur,
  codes,
  onChange,
  obligatoire = false,
  lecture = false,
}: {
  valeur: string | null;
  codes: CodeAnalytique[];
  onChange?: (id: string | null) => void;
  obligatoire?: boolean;
  lecture?: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [filtre, setFiltre] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOuvert(false);
    };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false); };
    document.addEventListener('mousedown', dehors);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('keydown', echap);
    };
  }, [ouvert]);

  const choisi = codes.find((c) => c.id === valeur) ?? null;
  const manquant = obligatoire && !choisi;
  const visibles = filtre
    ? codes.filter((c) => `${c.code} ${c.label}`.toLowerCase().includes(filtre.toLowerCase()))
    : codes;

  if (lecture) {
    return choisi
      ? <span className="code-cell" title={choisi.label}>{choisi.code}</span>
      : <span className="muted">À ventiler</span>;
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => { setOuvert((o) => !o); setFiltre(''); }}
        title={choisi ? `${choisi.code} — ${choisi.label}` : 'Obligatoire pour envoyer la commande'}
        style={{
          width: '100%', textAlign: 'left', padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
          border: `1px solid ${manquant ? 'var(--danger, #dc2626)' : 'var(--border)'}`,
          background: 'var(--card, #fff)', font: 'inherit', fontSize: 12,
          color: choisi ? undefined : 'var(--muted)',
        }}
      >
        {choisi ? choisi.code : '— à renseigner —'}
      </button>

      {ouvert && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 60, marginTop: 2,
          width: 300, maxHeight: 260, overflow: 'auto',
          background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(15,23,42,.16)', padding: 6,
        }}>
          <input
            autoFocus
            value={filtre}
            placeholder="Code ou intitulé…"
            onChange={(e) => setFiltre(e.target.value)}
            style={{ width: '100%', marginBottom: 6 }}
          />
          <button
            type="button"
            onClick={() => { onChange?.(null); setOuvert(false); }}
            style={entree}
          >
            <span className="muted">— à renseigner —</span>
          </button>
          {visibles.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onChange?.(c.id); setOuvert(false); }}
              style={{ ...entree, background: c.id === valeur ? 'var(--surface)' : 'transparent' }}
            >
              <span className="code-cell" style={{ marginRight: 8 }}>{c.code}</span>
              <span>{c.label}</span>
            </button>
          ))}
          {visibles.length === 0 && (
            <div className="muted" style={{ fontSize: 12, padding: 8 }}>Aucun code ne correspond.</div>
          )}
        </div>
      )}
    </div>
  );
}

const entree: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', border: 'none', borderRadius: 6,
  padding: '5px 7px', background: 'transparent', font: 'inherit', fontSize: 12, cursor: 'pointer',
};
