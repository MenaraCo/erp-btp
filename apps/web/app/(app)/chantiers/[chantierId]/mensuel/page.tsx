'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { CalendarRange } from 'lucide-react';
import { LigneVide } from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';

/* ─────────── types ─────────── */
interface Triple { m: string; m1: string; cumul: string }
interface NatureFlows {
  nature: string;
  label: string;
  engage: Triple;
  realise: Triple;
}
interface Monthly {
  month: string;
  prevMonth: string;
  byNature: NatureFlows[];
  totals: { engage: Triple; realise: Triple };
  closed: boolean;
}

/** Mois courant au format YYYY-MM. */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** « 2026-06 » → « juin 2026 ». */
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const isZero = (t: Triple) => Number(t.m) === 0 && Number(t.m1) === 0 && Number(t.cumul) === 0;

/** Gestion mensuelle d'un chantier (cahier §5.8) : flux engagé/réalisé en 3 colonnes M / M-1 / CUMUL. */
export default function MensuelPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const chantierId = String(useParams().chantierId);
  const [month, setMonth] = useState(currentMonth());
  const [err, setErr] = useState<string | null>(null);

  const chantier = useQuery({
    queryKey: ['chantier', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ code: string }>(`/chantiers/${chantierId}`, { token }),
  });
  const monthly = useQuery({
    queryKey: ['monthly', chantierId, month],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Monthly>(`/chantiers/${chantierId}/monthly?month=${month}`, { token }),
  });

  const close = useMutation({
    mutationFn: () => apiFetch(`/chantiers/${chantierId}/monthly/${month}/close`, { method: 'POST', token }),
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ['monthly', chantierId, month] }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const d = monthly.data;
  const rows = (d?.byNature ?? []).filter((n) => !isZero(n.engage) || !isZero(n.realise));

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {chantier.data?.code ?? ''}</Link>
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 4 }}>Gestion mensuelle</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          <label className="muted" style={{ fontSize: 12 }}>Mois</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 160 }} />
          {d && (
            d.closed
              ? <span className="badge success">Mois clôturé</span>
              : <button className="btn btn-secondary" disabled={close.isPending} onClick={() => close.mutate()}>Clôturer le mois</button>
          )}
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Engagé et réalisé par nature, sur trois temps : mois en cours, mois précédent, cumul depuis le début.
      </p>

      {err && <div className="error">{err}</div>}
      {monthly.isError && (
        <p className="muted">Module « Gestion financière » non actif pour cet utilisateur, ou accès refusé.</p>
      )}

      {d && (
        <div className="card" style={{ marginTop: 12, padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ margin: 0, minWidth: 720 }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ verticalAlign: 'bottom' }}>Nature</th>
                  <th colSpan={3} style={{ textAlign: 'center', borderLeft: '1px solid var(--border)' }}>Engagé</th>
                  <th colSpan={3} style={{ textAlign: 'center', borderLeft: '1px solid var(--border)' }}>Réalisé</th>
                </tr>
                <tr>
                  <ColHead label={monthLabel(d.month)} />
                  <ColHead label={monthLabel(d.prevMonth)} />
                  <ColHead label="Cumul" strong />
                  <ColHead label={monthLabel(d.month)} borderLeft />
                  <ColHead label={monthLabel(d.prevMonth)} />
                  <ColHead label="Cumul" strong />
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.nature}>
                    <td>{n.label}</td>
                    <Money v={n.engage.m} borderLeft />
                    <Money v={n.engage.m1} muted />
                    <Money v={n.engage.cumul} strong />
                    <Money v={n.realise.m} borderLeft />
                    <Money v={n.realise.m1} muted />
                    <Money v={n.realise.cumul} strong />
                  </tr>
                ))}
                {rows.length === 0 && (
                  <LigneVide
                    colonnes={7}
                    icone={CalendarRange}
                    titre="Aucun mouvement sur la période."
                    indice="Les pointages, achats et factures du mois alimentent ce relevé."
                  />
                )}
                {d && (
                  <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                    <td>Total chantier</td>
                    <Money v={d.totals.engage.m} borderLeft />
                    <Money v={d.totals.engage.m1} />
                    <Money v={d.totals.engage.cumul} strong />
                    <Money v={d.totals.realise.m} borderLeft />
                    <Money v={d.totals.realise.m1} />
                    <Money v={d.totals.realise.cumul} strong />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ColHead({ label, strong, borderLeft }: { label: string; strong?: boolean; borderLeft?: boolean }) {
  return (
    <th style={{
      textAlign: 'right', fontSize: 11, textTransform: 'capitalize',
      color: strong ? 'var(--primary)' : 'var(--muted)',
      borderLeft: borderLeft ? '1px solid var(--border)' : undefined,
    }}>
      {label}
    </th>
  );
}

function Money({ v, strong, muted, borderLeft }: { v: string; strong?: boolean; muted?: boolean; borderLeft?: boolean }) {
  const zero = Number(v) === 0;
  return (
    <td style={{
      textAlign: 'right', fontVariantNumeric: 'tabular-nums',
      fontWeight: strong ? 600 : undefined,
      color: zero ? 'var(--muted)' : muted ? 'var(--muted)' : undefined,
      borderLeft: borderLeft ? '1px solid var(--border)' : undefined,
    }}>
      {zero ? '—' : euro(v)}
    </td>
  );
}
