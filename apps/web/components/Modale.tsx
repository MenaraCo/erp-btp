'use client';

import { useEffect } from 'react';

/**
 * Fenêtre modale — brique UNIQUE du socle de présentation.
 *
 * Neuf écrans redéfinissaient chacun leur voile, leur panneau, leur croix de fermeture et leurs
 * marges : neuf occasions de dériver. Ici, une seule définition — et un comportement acquis
 * partout : Échap ferme, le clic sur le voile ferme, le clic dans le panneau ne ferme pas.
 *
 * `largeur` couvre les usages réels : `s` pour une confirmation, `m` pour un formulaire, `l` pour
 * une fiche, `xl` pour une grille (choix de ressources, rapprochement).
 */
export type LargeurModale = 's' | 'm' | 'l' | 'xl';

const LARGEURS: Record<LargeurModale, number> = { s: 420, m: 560, l: 720, xl: 1000 };

export function Modale({
  titre,
  sousTitre,
  largeur = 'm',
  onClose,
  actions,
  children,
}: {
  titre: string;
  sousTitre?: string;
  largeur?: LargeurModale;
  onClose: () => void;
  /** Boutons du pied ; le bouton « Annuler » y est ajouté d'office à gauche. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', echap);
    return () => document.removeEventListener('keydown', echap);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '48px 20px', overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        className="modal-box"
        style={{
          borderRadius: 12, padding: '20px 24px',
          width: LARGEURS[largeur], maxWidth: '100%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: 16, marginBottom: 14,
        }}>
          <div>
            <strong style={{ fontSize: 16 }}>{titre}</strong>
            {sousTitre && (
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 12, lineHeight: 1.45 }}>
                {sousTitre}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            title="Fermer"
            onClick={onClose}
            style={{ fontSize: 18, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {children}

        {actions && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, justifyContent: 'flex-end',
          }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
