'use client';

import { useEffect, useRef, useState } from 'react';
import { STATUT_AFFAIRE, statut } from '@/lib/statuts';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Check } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * Statut commercial du devis, en UN seul contrôle : la pastille affiche l'état courant et ouvre
 * les transitions possibles. Auparavant l'écran portait un badge d'état PUIS une rangée de boutons
 * pleins — deux fois la même information, et une ligne entière consommée dans l'en-tête.
 *
 * Le devis ne porte que son avancement COMMERCIAL : la création du marché et du chantier relève
 * de l'outil d'acceptation de commande, pas d'un statut.
 */
const TRANSITIONS: Record<string, string[]> = {
  open: ['sent', 'won', 'lost'],
  sent: ['open', 'won', 'lost', 'followup', 'revision'],
  won: ['lost'],
  lost: ['followup', 'revision', 'won'],
  followup: ['open', 'sent', 'won', 'lost', 'revision'],
  revision: ['open', 'sent'],
};

interface StatusLook {
  label: string;
  /** Pastille : couleur du point et fond/bordure assortis, lisibles sans crier. */
  dot: string;
  bg: string;
  border: string;
  text: string;
}

// Le libellé vient du registre des statuts ; seules les teintes du sélecteur sont propres à ce
// contrôle (pastille de couleur), pour qu'un statut ne se dise jamais autrement ici qu'ailleurs.
const TEINTES: Record<string, Omit<StatusLook, 'label'>> = {
  open: { dot: '#64748b', bg: '#f1f5f9', border: '#cbd5e1', text: '#334155' },
  sent: { dot: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' },
  won: { dot: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' },
  lost: { dot: '#dc2626', bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
  followup: { dot: '#d97706', bg: '#fffbeb', border: '#fde68a', text: '#b45309' },
  revision: { dot: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', text: '#6d28d9' },
};
const LOOK: Record<string, StatusLook> = Object.fromEntries(
  Object.entries(TEINTES).map(([code, teinte]) => [
    code, { ...teinte, label: statut(STATUT_AFFAIRE, code).label },
  ]),
);

const fallback = (s: string): StatusLook => ({
  label: s, dot: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0', text: '#475569',
});

export function StatusControl({
  devisId,
  status,
  onChanged,
  readOnly = false,
}: {
  devisId: string;
  status: string;
  onChanged: () => void;
  readOnly?: boolean;
}) {
  const token = useAuth().token;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const next = TRANSITIONS[status] ?? [];
  const look = LOOK[status] ?? fallback(status);

  const transition = useMutation({
    mutationFn: (to: string) =>
      apiFetch(`/devis/${devisId}/transition`, { method: 'POST', body: { to }, token }),
    onSuccess: () => { setErr(null); setOpen(false); onChanged(); },
    onError: (e) => {
      setErr(e instanceof ApiError ? e.message : 'Changement de statut impossible.');
      setOpen(false);
    },
  });

  // Le menu est rendu dans <body> : l'éditeur a des conteneurs qui rogneraient un survol absolu.
  useEffect(() => {
    if (!open) return;
    // Le menu vit dans un portail : sans l'exclure ici, le `mousedown` sur une action fermerait
    // le menu — donc démonterait le bouton — avant que le `click` ne parte. Rien ne se passait.
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
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

  const toggle = () => {
    if (readOnly || next.length === 0) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left });
    setOpen((v) => !v);
  };

  const interactive = !readOnly && next.length > 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={transition.isPending}
        title={interactive ? 'Changer le statut du devis' : `Statut : ${look.label}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 9px 3px 8px', borderRadius: 999,
          border: `1px solid ${look.border}`, background: look.bg, color: look.text,
          fontSize: 11.5, fontWeight: 600, lineHeight: 1.6,
          cursor: interactive ? 'pointer' : 'default',
          opacity: transition.isPending ? 0.6 : 1,
          transition: 'box-shadow .12s, border-color .12s',
          boxShadow: open ? `0 0 0 3px ${look.border}55` : 'none',
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: look.dot, flexShrink: 0 }} />
        {look.label}
        {interactive && <ChevronDown size={12} style={{ opacity: 0.6, marginLeft: -1 }} />}
      </button>

      {err && (
        <span className="error" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6 }}>{err}</span>
      )}

      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 3000,
            minWidth: 190, padding: 4, borderRadius: 10,
            background: '#fff', border: '1px solid var(--border)',
            boxShadow: '0 10px 30px rgba(15,23,42,.13), 0 2px 6px rgba(15,23,42,.06)',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', padding: '5px 8px 4px' }}>
            Faire passer à
          </div>
          {next.map((to) => {
            const l = LOOK[to] ?? fallback(to);
            return (
              <button
                key={to}
                type="button"
                onClick={() => { setErr(null); transition.mutate(to); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 8px', borderRadius: 6, border: 'none', background: 'transparent',
                  cursor: 'pointer', fontSize: 12.5, color: '#334155', textAlign: 'left',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: l.dot, flexShrink: 0 }} />
                {l.label}
              </button>
            );
          })}
          {status === 'won' && (
            <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0 0', padding: '7px 8px 4px', fontSize: 11, color: 'var(--muted)', lineHeight: 1.45 }}>
              <Check size={11} style={{ verticalAlign: -1, marginRight: 4, color: '#16a34a' }} />
              Devis gagné : marché, chantier et budgets se créent dans
              {' '}<strong style={{ color: 'var(--primary)' }}>Acceptation de commande</strong>.
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
