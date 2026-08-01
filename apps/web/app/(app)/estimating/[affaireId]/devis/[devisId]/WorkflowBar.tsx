'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * Statut commercial du devis (miroir du backend devis-workflow.ts).
 *
 * Le devis ne porte plus que son avancement COMMERCIAL. Le passage à l'exécution — création
 * du marché et du chantier — relève de l'outil d'acceptation de commande, et non d'une
 * transition de statut : c'est lui qui fait le pont vers le suivi de chantier et la facturation.
 */
const TRANSITIONS: Record<string, string[]> = {
  open: ['sent', 'won', 'lost'],
  sent: ['won', 'lost', 'followup', 'revision'],
  won: ['lost'],
  lost: ['followup', 'revision', 'won'],
  followup: ['sent', 'won', 'lost', 'revision'],
  revision: ['open', 'sent'],
};

const ACTION_LABELS: Record<string, string> = {
  open: 'Remettre en cours',
  sent: 'Marquer envoyé',
  won: 'Marquer gagné',
  lost: 'Marquer perdu',
  followup: 'Relancer',
  revision: 'Réviser',
};

/** Actions mises en avant : celles qui font progresser l'affaire. */
const PRIMARY = new Set(['sent', 'won']);

export function WorkflowBar({
  devisId,
  status,
  onChanged,
}: {
  devisId: string;
  status: string;
  onChanged: () => void;
}) {
  const token = useAuth().token;
  const [err, setErr] = useState<string | null>(null);
  const next = TRANSITIONS[status] ?? [];

  const transition = useMutation({
    mutationFn: (to: string) =>
      apiFetch(`/devis/${devisId}/transition`, { method: 'POST', body: { to }, token }),
    onSuccess: () => { setErr(null); onChanged(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Changement de statut impossible.'),
  });

  return (
    <div style={{ marginTop: 8 }}>
      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
      {next.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 11 }}>Statut :</span>
          {next.map((to) => (
            <button
              key={to}
              type="button"
              className={PRIMARY.has(to) ? 'btn' : 'btn-secondary'}
              style={{ fontSize: 12, padding: '4px 10px' }}
              disabled={transition.isPending}
              onClick={() => { setErr(null); transition.mutate(to); }}
            >
              {ACTION_LABELS[to] ?? to}
              {PRIMARY.has(to) && <ArrowRight size={12} style={{ verticalAlign: 'middle' }} />}
            </button>
          ))}
          {status === 'won' && (
            <span className="muted" style={{ fontSize: 11 }}>
              — la suite se fait dans{' '}
              <Link href="/acceptation" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                Acceptation de commande
              </Link>{' '}
              : marché, chantier et budgets.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
