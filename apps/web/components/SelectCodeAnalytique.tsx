'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PositionFlottante, positionFlottante, suivreAncre } from '@/lib/flottant';

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
const LARGEUR = 300;
const HAUTEUR = 280;

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
  /** Entrée surlignée au clavier : -1 = « à renseigner », puis l'index dans la liste filtrée. */
  const [actif, setActif] = useState(-1);
  const [pos, setPos] = useState<PositionFlottante | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const surligne = useRef<HTMLButtonElement | null>(null);

  const placer = useCallback(() => {
    const r = bouton.current?.getBoundingClientRect();
    if (r) setPos(positionFlottante(r, LARGEUR, HAUTEUR));
  }, []);

  // L'entrée surlignée reste visible : sans cela, la flèche descend hors du cadre de la liste.
  useEffect(() => {
    if (ouvert) surligne.current?.scrollIntoView({ block: 'nearest' });
  }, [actif, ouvert]);

  // Tant que la liste est ouverte, elle suit sa ligne : défiler ne doit pas la décrocher.
  useEffect(() => {
    if (!ouvert) return undefined;
    return suivreAncre(placer);
  }, [ouvert, placer]);

  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e: MouseEvent) => {
      const dansLaListe = document.getElementById('liste-codes-analytiques')?.contains(e.target as Node);
      if (!ref.current?.contains(e.target as Node) && !dansLaListe) setOuvert(false);
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
        ref={bouton}
        type="button"
        onClick={() => {
          if (ouvert) { setOuvert(false); return; }
          // Position calculée au clic : la liste est rendue en PORTAIL, sinon le tableau la rogne.
          // Le placement partagé bascule au-dessus quand la ligne est en bas de l'écran.
          placer();
          setFiltre('');
          setActif(-1);
          setOuvert(true);
        }}
        title={choisi ? `${choisi.code} — ${choisi.label}` : 'Obligatoire pour envoyer la commande'}
        style={{
          width: '100%', textAlign: 'left', padding: '2px 4px', borderRadius: 0, cursor: 'pointer',
          border: 'none', background: 'transparent', font: 'inherit', fontSize: 12, height: 22,
          color: choisi ? undefined : 'var(--muted)',
          boxShadow: manquant ? 'inset 0 0 0 1.5px var(--danger, #dc2626)' : undefined,
        }}
      >
        {choisi ? choisi.code : '—'}
      </button>

      {ouvert && pos && createPortal(
        <div id="liste-codes-analytiques" style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 2000,
          width: LARGEUR, maxHeight: pos.maxHeight, overflow: 'auto',
          background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(15,23,42,.16)', padding: 6,
        }}>
          <input
            autoFocus
            value={filtre}
            placeholder="Code ou intitulé…"
            onChange={(e) => { setFiltre(e.target.value); setActif(-1); }}
            // Flèches, Entrée, Échap : on choisit au clavier sans lâcher la saisie du filtre.
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActif((i) => Math.min(i + 1, visibles.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActif((i) => Math.max(i - 1, -1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const c = visibles[actif];
                onChange?.(actif >= 0 && c ? c.id : null);
                setOuvert(false);
              }
            }}
            style={{ width: '100%', marginBottom: 6 }}
          />
          <button
            type="button"
            ref={(el) => { if (actif === -1) surligne.current = el; }}
            onClick={() => { onChange?.(null); setOuvert(false); }}
            style={{ ...entree, background: actif === -1 ? 'var(--surface)' : 'transparent' }}
          >
            <span className="muted">— à renseigner —</span>
          </button>
          {visibles.map((c, i) => (
            <button
              key={c.id}
              type="button"
              ref={(el) => { if (actif === i) surligne.current = el; }}
              onMouseEnter={() => setActif(i)}
              onClick={() => { onChange?.(c.id); setOuvert(false); }}
              style={{
                ...entree,
                background: actif === i || (actif === -1 && c.id === valeur) ? 'var(--surface)' : 'transparent',
              }}
            >
              <span className="code-cell" style={{ marginRight: 8 }}>{c.code}</span>
              <span>{c.label}</span>
            </button>
          ))}
          {visibles.length === 0 && (
            <div className="muted" style={{ fontSize: 12, padding: 8 }}>Aucun code ne correspond.</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

const entree: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', border: 'none', borderRadius: 6,
  padding: '5px 7px', background: 'transparent', font: 'inherit', fontSize: 12, cursor: 'pointer',
};
