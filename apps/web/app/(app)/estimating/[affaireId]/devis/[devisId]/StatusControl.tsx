'use client';

import { useEffect, useRef, useState } from 'react';
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
  sent: ['won', 'lost', 'followup', 'revision'],
  won: ['lost'],
  lost: ['followup', 'revision', 'won'],
  followup: ['sent', 'won', 'lost', 'revision'],
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

const LOOK: Record<string, StatusLook> = {
  open: { label: 'En cours', dot: '#64748b', bg: '#f1f5f9', border: '#cbd5e1', text: '#334155' },
  sent: { label: 'Envoyé', dot: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' },
  won: { label: 'Gagné', dot: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' },
  lost: { label: 'Perdu', dot: '#dc2626', bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
  followup: { label: 'Relancé', dot: '#d97706', bg: '#fffbeb', border: '#fde68a', text: '#b45309' },
  revision: { label: 'Révision', dot: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', text: '#6d28d9' },
};

const fallback = (s: string): StatusLook => ({
  label: s, dot: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0', text: '#475569',
});

/** Verbe de l'action, à la place du simple nom d'état : on choisit ce qu'on FAIT. */
const ACTION: Record<string, string> = {
  open: 'Remettre en cours',
  sent: 'Marquer envoyé',
  won: 'Marquer gagné',
  lost: 'Marquer perdu',
  followup: 'Relancer',
  revision: 'Mettre en révision',
};

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
    const close = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node)) setOpen(false);
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
                {ACTION[to] ?? l.label}
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
