'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { euro } from '@/lib/format';

interface DevisTotals { debourse: string; revient: string; pvHt: string; margeNette: string; margeNettePct: string }
interface DevisRow {
  id: string; numero: string | null; designation: string | null; status: string;
  affaire_code: string; affaire_name: string; created_at: string | null;
  totals: DevisTotals | null;
}

const STATUS_LABEL: Record<string, string> = {
  won: 'Accepté', lost: 'Refusé', sent: 'Envoyé',
  open: 'En cours', followup: 'Relancé', revision: 'Révision',
};
const badgeClass = (s: string) =>
  s === 'won' ? 'badge success' : s === 'lost' ? 'badge danger' : s === 'sent' ? 'badge info' : 'badge';
const pv = (d: DevisRow) => Number(d.totals?.pvHt ?? 0);
const deb = (d: DevisRow) => Number(d.totals?.debourse ?? 0);

export default function DashboardPage() {
  const { token } = useAuth();
  const devisQ = useQuery({
    queryKey: ['devis-list'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<DevisRow[]>('/devis', { token }),
  });
  const clientsQ = useQuery({
    queryKey: ['count', '/clients'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ total: number }>('/clients?pageSize=1', { token }),
  });

  const devis = devisQ.data ?? [];
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM

  const won = devis.filter((d) => d.status === 'won');
  const sent = devis.filter((d) => d.status === 'sent');
  const lost = devis.filter((d) => d.status === 'lost');
  const drafts = devis.filter((d) => !['won', 'lost', 'sent'].includes(d.status));

  const caAccepte = won.reduce((s, d) => s + pv(d), 0);
  const deboursAccepte = won.reduce((s, d) => s + deb(d), 0);
  const caPrevisionnel = sent.reduce((s, d) => s + pv(d), 0);
  const caMois = devis.filter((d) => d.created_at?.startsWith(month)).reduce((s, d) => s + pv(d), 0);
  const nbMois = devis.filter((d) => d.created_at?.startsWith(month)).length;
  const tauxTransfo = devis.length ? Math.round((won.length / devis.length) * 100) : 0;

  const recent = [...devis]
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 8);

  const loading = devisQ.isLoading;

  return (
    <div>
      <h1 style={{ marginBottom: 2 }}>Tableau de bord</h1>
      <p className="muted" style={{ marginTop: 0 }}>Études de prix — synthèse commerciale et financière.</p>

      {/* KPI financiers */}
      <div style={kpiGrid}>
        <KpiCard label="CA accepté (total)" value={euro(caAccepte)} accent
          sub={`Déboursé ${euro(deboursAccepte)}`} loading={loading} />
        <KpiCard label="CA prévisionnel" value={euro(caPrevisionnel)}
          sub={`${sent.length} devis envoyé(s)`} loading={loading} />
        <KpiCard label="CA ce mois" value={euro(caMois)}
          sub={`${nbMois} devis créé(s)`} loading={loading} />
        <KpiCard label="Taux de transformation" value={`${tauxTransfo} %`} good
          sub={`${won.length} accepté(s) / ${devis.length} total`} loading={loading} />
        <KpiCard label="Clients" value={clientsQ.data?.total ?? '—'} sub="Référentiel" loading={clientsQ.isLoading} />
      </div>

      {/* Devis par statut */}
      <div className="form-section-title" style={{ marginTop: 24 }}>Devis par statut</div>
      <div style={statusGrid}>
        <StatusTile n={drafts.length} label="Brouillons" color="#64748b" />
        <StatusTile n={sent.length} label="Envoyés" color="#2563eb" />
        <StatusTile n={won.length} label="Acceptés" color="#16a34a" />
        <StatusTile n={lost.length} label="Refusés" color="#dc2626" />
      </div>

      {/* Derniers devis */}
      <div className="card" style={{ marginTop: 24, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px' }}>
          <div className="form-section-title" style={{ margin: 0 }}>Derniers devis</div>
          <Link className="link" href="/estimating/devis">Voir tout →</Link>
        </div>
        <table className="data-grid" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Numéro</th><th>Client</th><th style={{ textAlign: 'right' }}>Total HT</th>
              <th style={{ textAlign: 'right' }}>Marge</th><th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>Chargement…</td></tr>
            ) : recent.length === 0 ? (
              <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>Aucun devis.</td></tr>
            ) : recent.map((d) => (
              <tr key={d.id}>
                <td style={{ fontWeight: 600, color: 'var(--accent)' }}>{d.numero ?? '—'}</td>
                <td>{d.affaire_name || d.affaire_code || '—'}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(pv(d))}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#64748b' }}>
                  {d.totals ? `${d.totals.margeNettePct} %` : '—'}
                </td>
                <td><span className={badgeClass(d.status)}>{STATUS_LABEL[d.status] ?? d.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, accent, good, loading }: {
  label: string; value: string | number; sub?: string; accent?: boolean; good?: boolean; loading?: boolean;
}) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color: good ? 'var(--success)' : accent ? 'var(--accent)' : 'var(--primary)' }}>
        {loading ? '…' : value}
      </div>
      {sub && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function StatusTile({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px', textAlign: 'center', borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{n}</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{label}</div>
    </div>
  );
}

const kpiGrid: React.CSSProperties = {
  display: 'grid', gap: 12, marginTop: 16,
  gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
};
const statusGrid: React.CSSProperties = {
  display: 'grid', gap: 12, marginTop: 8,
  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
};
