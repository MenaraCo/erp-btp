'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Building2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/* Machine à états (miroir du backend devis-workflow.ts). */
const TRANSITIONS: Record<string, string[]> = {
  open: ['study'],
  study: ['coeffs_proposed'],
  coeffs_proposed: ['coeffs_validated', 'study'],
  coeffs_validated: ['sent', 'coeffs_proposed'],
  sent: ['won', 'lost', 'followup', 'revision'],
  won: [],
  lost: ['followup', 'revision'],
  followup: ['sent', 'revision'],
  revision: ['study'],
};
/** Libellé d'action pour aller vers un état. */
const ACTION_LABELS: Record<string, string> = {
  study: 'Démarrer l’étude',
  coeffs_proposed: 'Proposer les coefficients',
  coeffs_validated: 'Valider les coefficients',
  sent: 'Marquer envoyé',
  won: 'Marquer gagné',
  lost: 'Marquer perdu',
  followup: 'Relancer',
  revision: 'Réviser',
};
/** Actions « positives » mises en avant. */
const PRIMARY = new Set(['study', 'coeffs_proposed', 'coeffs_validated', 'sent', 'won']);

interface TransferCheck {
  status: string;
  transferable: boolean;
  alerts: { level: 'blocking' | 'warning'; message: string }[];
}
interface Chantier { id: string; code: string; name: string | null }

/**
 * Barre de workflow d'un devis (cahier §5.3/§5.4) : fait avancer le devis dans la machine à états
 * et, une fois gagné, le transfère en chantier/marché (le pont vers l'exécution et la facturation).
 */
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
    mutationFn: (to: string) => apiFetch(`/devis/${devisId}/transition`, { method: 'POST', body: { to }, token }),
    onSuccess: () => { setErr(null); onChanged(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Transition impossible'),
  });

  return (
    <div style={{ marginTop: 8 }}>
      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
      {next.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 11 }}>Faire avancer :</span>
          {next.map((to) => (
            <button
              key={to}
              type="button"
              className={PRIMARY.has(to) ? 'btn' : 'btn-secondary'}
              style={{ fontSize: 12, padding: '4px 10px' }}
              disabled={transition.isPending}
              onClick={() => { setErr(null); transition.mutate(to); }}
            >
              {ACTION_LABELS[to] ?? to} {PRIMARY.has(to) && <ArrowRight size={12} style={{ verticalAlign: 'middle' }} />}
            </button>
          ))}
        </div>
      )}
      {status === 'won' && <TransferPanel devisId={devisId} token={token} onChanged={onChanged} />}
    </div>
  );
}

function TransferPanel({
  devisId,
  token,
  onChanged,
}: {
  devisId: string;
  token: string | null;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [chantierId, setChantierId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ chantierId: string; marcheCode: string } | null>(null);

  const check = useQuery({
    queryKey: ['transfer-check', devisId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<TransferCheck>(`/devis/${devisId}/transfer-check`, { token }),
  });
  const chantiers = useQuery({
    queryKey: ['chantiers-list'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Chantier[]>(`/chantiers`, { token }),
  });

  const accept = useMutation({
    mutationFn: () =>
      apiFetch<{ chantier: { id: string }; marche: { code: string } }>(`/devis/${devisId}/accept`, {
        method: 'POST',
        token,
        body: mode === 'existing' && chantierId ? { chantierId } : {},
      }),
    onSuccess: (res) => {
      setErr(null);
      setDone({ chantierId: res.chantier.id, marcheCode: res.marche.code });
      qc.invalidateQueries({ queryKey: ['chantiers-list'] });
      onChanged();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Transfert impossible'),
  });

  if (done) {
    return (
      <div className="card" style={{ marginTop: 10, borderColor: 'var(--accent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={16} style={{ color: 'var(--accent)' }} />
          <strong>Marché {done.marcheCode} créé</strong>
        </div>
        <p className="muted" style={{ margin: '6px 0 10px' }}>
          Le devis est transféré : le chantier (suivi + budget) et la chaîne de facturation (situations) sont prêts.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href={`/chantiers/${done.chantierId}`} className="btn">Ouvrir le chantier</Link>
          <Link href="/invoicing" className="btn btn-secondary">Aller à la facturation</Link>
        </div>
      </div>
    );
  }

  const blocking = check.data?.alerts.filter((a) => a.level === 'blocking') ?? [];
  const warnings = check.data?.alerts.filter((a) => a.level === 'warning') ?? [];

  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Building2 size={16} style={{ color: 'var(--primary)' }} />
        <strong>Transférer en chantier</strong>
      </div>
      {check.isError && <p className="muted" style={{ margin: 0 }}>Capacité « Facturation » requise pour transférer (permission invoicing.write).</p>}
      {err && <div className="error">{err}</div>}

      {blocking.map((a, i) => (
        <div key={i} className="error" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <AlertTriangle size={14} /> {a.message}
        </div>
      ))}
      {warnings.map((a, i) => (
        <div key={i} className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
          <AlertTriangle size={13} style={{ color: '#f59e0b' }} /> {a.message}
        </div>
      ))}

      {check.data && (
        <>
          <div style={{ display: 'flex', gap: 16, margin: '8px 0', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> Nouveau chantier
            </label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Chantier existant
            </label>
            {mode === 'existing' && (
              <select value={chantierId} onChange={(e) => setChantierId(e.target.value)} style={{ minWidth: 220 }}>
                <option value="">— Choisir un chantier —</option>
                {(chantiers.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.code}{c.name ? ` — ${c.name}` : ''}</option>
                ))}
              </select>
            )}
          </div>
          <button
            className="btn"
            disabled={accept.isPending || blocking.length > 0 || (mode === 'existing' && !chantierId)}
            onClick={() => { setErr(null); accept.mutate(); }}
          >
            {accept.isPending ? 'Transfert…' : 'Transférer en chantier'}
          </button>
        </>
      )}
    </div>
  );
}
