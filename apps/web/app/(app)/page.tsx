'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS } from '@/lib/format';

interface EstimatingStats {
  affaires: { total: number; byStatus: Record<string, number> };
  devis: { total: number; byStatus: Record<string, number>; won: number; lost: number; tauxReussite: number | null };
}

const AFFAIRE_DERIVED_LABELS: Record<string, string> = {
  en_cours: 'En cours', gagnee_partielle: 'Gagnée part.', gagnee: 'Gagnée', perdue: 'Perdue',
};
const affaireBadge = (s: string) =>
  s === 'gagnee' ? 'badge success' : s === 'perdue' ? 'badge danger' : s === 'gagnee_partielle' ? 'badge info' : 'badge';
const devisBadge = (s: string) =>
  s === 'won' ? 'badge success' : s === 'lost' ? 'badge danger' : s === 'sent' || s === 'coeffs_validated' ? 'badge info' : 'badge';

const FINAL = new Set(['won', 'lost']);

export default function DashboardPage() {
  const { token, email } = useAuth();
  const stats = useQuery({
    queryKey: ['estimating-stats'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<EstimatingStats>('/estimating/stats', { token }),
  });
  const clients = useQuery({
    queryKey: ['count', '/clients'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ total: number }>('/clients?pageSize=1', { token }),
  });

  const s = stats.data;
  const enCours = s ? Object.entries(s.devis.byStatus).reduce((acc, [k, v]) => acc + (FINAL.has(k) ? 0 : v), 0) : 0;

  return (
    <div>
      <h1>Tableau de bord</h1>
      <p className="muted" style={{ marginTop: 0 }}>Synthèse des études de prix — bienvenue, {email}.</p>

      <div className="card-grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Affaires</h2>
          <div className="stat">{stats.isLoading ? '…' : s?.affaires.total ?? '—'}</div>
          <div className="muted"><Link className="link" href="/estimating">Voir les affaires →</Link></div>
        </div>
        <div className="card">
          <h2>Devis</h2>
          <div className="stat">{stats.isLoading ? '…' : s?.devis.total ?? '—'}</div>
          <div className="muted"><Link className="link" href="/estimating/devis">Voir les devis →</Link></div>
        </div>
        <div className="card">
          <h2>Devis en étude</h2>
          <div className="stat">{stats.isLoading ? '…' : enCours}</div>
          <div className="muted"><Link className="link" href="/estimating/planning">Planning →</Link></div>
        </div>
        <div className="card">
          <h2>Taux de réussite</h2>
          <div className="stat" style={{ color: 'var(--success)' }}>{s?.devis.tauxReussite != null ? `${s.devis.tauxReussite} %` : '—'}</div>
          <div className="muted">{s ? `${s.devis.won} gagnés · ${s.devis.lost} perdus` : ''}</div>
        </div>
        <div className="card">
          <h2>Clients</h2>
          <div className="stat">{clients.isLoading ? '…' : clients.data?.total ?? '—'}</div>
          <div className="muted">Référentiel</div>
        </div>
      </div>

      <div className="card-grid" style={{ marginTop: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        <div className="card">
          <div className="form-section-title">Répartition des affaires</div>
          {s && Object.keys(s.affaires.byStatus).length > 0 ? (
            Object.entries(s.affaires.byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} className="synthese-row">
                <span className="lbl"><span className={affaireBadge(k)}>{AFFAIRE_DERIVED_LABELS[k] ?? k}</span></span>
                <span className="val">{v}</span>
              </div>
            ))
          ) : <p className="muted">Aucune affaire.</p>}
        </div>
        <div className="card">
          <div className="form-section-title">Répartition des devis (workflow)</div>
          {s && Object.keys(s.devis.byStatus).length > 0 ? (
            Object.entries(s.devis.byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} className="synthese-row">
                <span className="lbl"><span className={devisBadge(k)}>{AFFAIRE_STATUS_LABELS[k] ?? k}</span></span>
                <span className="val">{v}</span>
              </div>
            ))
          ) : <p className="muted">Aucun devis.</p>}
        </div>
      </div>
    </div>
  );
}
