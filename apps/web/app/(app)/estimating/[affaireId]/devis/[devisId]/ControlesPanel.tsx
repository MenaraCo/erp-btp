'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { hauteurFlottante } from '@/lib/flottant';

/**
 * Contrôles du devis — le carnet de santé de l'étude, consultable à tout moment.
 *
 * Un devis se monte sur plusieurs jours, souvent à plusieurs, en recopiant des ouvrages : les
 * oublis sont la règle. Plutôt que de les découvrir une fois le devis parti, ce panneau les
 * énumère en continu : ressource sans code analytique, unité absente, prix vide ou à zéro, marge
 * négative… Chaque ligne cite l'endroit exact où corriger.
 */
type Niveau = 'bloquant' | 'avertissement' | 'info';

interface Controle {
  code: string;
  niveau: Niveau;
  message: string;
  lineId?: string;
  ligne?: string;
}
interface Resultat {
  controles: Controle[];
  compte: Record<Niveau, number>;
}

const LOOK: Record<Niveau, { label: string; color: string; bg: string; Icon: typeof AlertTriangle }> = {
  bloquant: { label: 'À corriger', color: '#b91c1c', bg: '#fef2f2', Icon: OctagonAlert },
  avertissement: { label: 'À vérifier', color: '#b45309', bg: '#fffbeb', Icon: AlertTriangle },
  info: { label: 'Pour information', color: '#475569', bg: '#f8fafc', Icon: Info },
};

const ORDRE: Niveau[] = ['bloquant', 'avertissement', 'info'];

export function ControlesPanel({ versionId }: { versionId: string | null }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['controles', versionId],
    enabled: Boolean(token && versionId),
    // Le devis bouge en permanence : on relit à chaque retour sur l'écran plutôt que de garder
    // un diagnostic périmé.
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    queryFn: () => apiFetch<Resultat>(`/versions/${versionId}/controles`, { token }),
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const compte = data?.compte ?? { bloquant: 0, avertissement: 0, info: 0 };
  const aSignaler = compte.bloquant + compte.avertissement;
  // Le point de la pastille dit l'essentiel sans ouvrir : rouge s'il y a bloquant, sinon ambre.
  const teinte = compte.bloquant > 0 ? LOOK.bloquant : compte.avertissement > 0 ? LOOK.avertissement : null;

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      // Bascule au-dessus si le bouton est en bas de l'écran : un panneau qui sort du cadre est
      // hors d'atteinte (il est `fixed`, la page ne le fait pas défiler).
      const v = hauteurFlottante(r, Math.round(window.innerHeight * 0.7), 8, 6);
      setPos({ top: v.top, maxHeight: v.maxHeight, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };

  const groupes = ORDRE.map((n) => ({
    niveau: n,
    items: (data?.controles ?? []).filter((c) => c.niveau === n),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={!versionId}
        title="Contrôles du devis"
        className="btn-secondary"
        style={{
          fontSize: 11, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 6,
          borderColor: teinte ? teinte.color + '55' : undefined,
          color: teinte ? teinte.color : undefined,
          background: teinte ? teinte.bg : undefined,
        }}
      >
        {teinte ? <teinte.Icon size={12} /> : <CheckCircle2 size={12} color="#16a34a" />}
        Contrôles
        {aSignaler > 0 && (
          <span
            style={{
              minWidth: 16, height: 16, borderRadius: 8, padding: '0 4px',
              background: teinte?.color ?? '#64748b', color: '#fff',
              fontSize: 10, fontWeight: 700, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            {aSignaler}
          </span>
        )}
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', top: pos.top, right: pos.right, zIndex: 3000,
            width: 420, maxHeight: pos.maxHeight, overflowY: 'auto',
            borderRadius: 12, background: '#fff', border: '1px solid var(--border)',
            boxShadow: '0 14px 40px rgba(15,23,42,.15), 0 2px 8px rgba(15,23,42,.06)',
          }}
        >
          <div style={{ padding: '11px 14px 9px', borderBottom: '1px solid var(--border)' }}>
            <strong style={{ fontSize: 13 }}>Contrôles du devis</strong>
            <p className="muted" style={{ margin: '3px 0 0', fontSize: 11, lineHeight: 1.45 }}>
              Ce qui manque ou cloche dans l’étude, à tout moment de sa vie.
            </p>
          </div>

          {groupes.length === 0 ? (
            <div style={{ padding: '18px 14px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#15803d' }}>
              <CheckCircle2 size={16} />
              Rien à signaler : le devis est complet.
            </div>
          ) : (
            groupes.map((g) => {
              const look = LOOK[g.niveau];
              return (
                <div key={g.niveau}>
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '7px 14px 5px', background: look.bg,
                      fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
                      textTransform: 'uppercase', color: look.color,
                    }}
                  >
                    <look.Icon size={12} />
                    {look.label} ({g.items.length})
                  </div>
                  {g.items.map((c, i) => (
                    <div
                      key={`${c.code}-${c.lineId ?? i}`}
                      style={{
                        padding: '8px 14px', borderBottom: '1px solid #f1f5f9',
                        fontSize: 12.5, lineHeight: 1.45, color: '#334155',
                      }}
                    >
                      {c.ligne && (
                        <div style={{ fontWeight: 600, color: 'var(--primary)', marginBottom: 1 }}>
                          {c.ligne}
                        </div>
                      )}
                      {c.message}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
