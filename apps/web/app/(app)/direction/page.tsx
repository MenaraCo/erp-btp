'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { euro } from '@/lib/format';

/* ─────────── types ─────────── */
interface PortfolioRow {
  chantierId: string;
  code: string;
  name: string | null;
  avancement: string;
  vente: string;
  budget: string;
  engage: string;
  realise: string;
  eac: string | null;
  margePrevisionnelle: string | null;
  margePrevisionnellePct: string | null;
  ecartAuStade: string;
  alerts: string[];
  riskScore: number;
}
interface Totals {
  vente: string;
  budget: string;
  engage: string;
  realise: string;
  eac: string;
  margePrevisionnelle: string;
  margePrevisionnellePct: string | null;
  chantiers: number;
  aRisque: number;
}
interface Portfolio {
  rows: PortfolioRow[];
  totals: Totals;
}

const ALERT_LABELS: Record<string, string> = {
  ecart: 'Écart au stade',
  marge: 'Marge sous la cible',
};

function pct(v: string | null): string {
  if (v == null) return '—';
  return `${(Number(v) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}
/** Vert si positif, rouge si négatif — le rouge réservé aux dérives (cahier UI). */
function signColor(v: string | null): string | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  if (n < 0) return '#dc2626';
  if (n > 0) return '#16a34a';
  return undefined;
}

/** Vue Direction (cahier §5.8) : portefeuille de chantiers, chantiers à risque en tête. */
export default function DirectionPage() {
  const { token } = useAuth();
  const router = useRouter();
  const portfolio = useQuery({
    queryKey: ['portfolio'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Portfolio>('/financial/portfolio', { token }),
  });

  if (portfolio.isError) {
    return (
      <div>
        <h1>Direction</h1>
        <p className="muted">
          Module « Gestion financière » non actif pour cet utilisateur, ou accès refusé.
        </p>
      </div>
    );
  }

  const t = portfolio.data?.totals;

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Direction</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Portefeuille de chantiers en temps réel — les chantiers à risque sont classés en tête.
      </p>

      {t && (
        <div className="card-grid" style={{ marginTop: 12 }}>
          <div className="card"><h2>Vente portefeuille</h2><div className="stat">{euro(t.vente)}</div></div>
          <div className="card"><h2>Réalisé + engagé</h2><div className="stat">{euro((Number(t.realise) + Number(t.engage)).toFixed(2))}</div></div>
          <div className="card">
            <h2>Marge prévisionnelle</h2>
            <div className="stat" style={{ color: signColor(t.margePrevisionnelle) }}>{euro(t.margePrevisionnelle)}</div>
            <div className="muted">{pct(t.margePrevisionnellePct)}</div>
          </div>
          <div className="card">
            <h2>Chantiers à risque</h2>
            <div className="stat" style={{ color: t.aRisque > 0 ? '#dc2626' : undefined }}>
              {t.aRisque} / {t.chantiers}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        {portfolio.isLoading && <p className="muted" style={{ padding: 16 }}>Chargement…</p>}
        {portfolio.data && portfolio.data.rows.length === 0 && (
          <p className="muted" style={{ padding: 16 }}>Aucun chantier.</p>
        )}
        {portfolio.data && portfolio.data.rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
          <table className="grid" style={{ margin: 0, minWidth: 820 }}>
            <thead>
              <tr>
                <th>Chantier</th>
                <th style={{ textAlign: 'right' }}>Avanc.</th>
                <th style={{ textAlign: 'right' }}>Vente</th>
                <th style={{ textAlign: 'right' }}>Engagé</th>
                <th style={{ textAlign: 'right' }}>Réalisé</th>
                <th style={{ textAlign: 'right' }}>Prév. fin (EAC)</th>
                <th style={{ textAlign: 'right' }}>Marge prév.</th>
                <th style={{ textAlign: 'right' }}>Taux</th>
                <th>Alertes</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.data.rows.map((r) => (
                <tr
                  key={r.chantierId}
                  style={{ cursor: 'pointer' }}
                  onClick={() => router.push(`/chantiers/${r.chantierId}`)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                >
                  <td>
                    <span className="code-cell">{r.code}</span>
                    {r.name && <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>{r.name}</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{pct(r.avancement)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(r.vente)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(r.engage)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(r.realise)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.eac ? euro(r.eac) : '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: signColor(r.margePrevisionnelle) }}>
                    {r.margePrevisionnelle ? euro(r.margePrevisionnelle) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: signColor(r.margePrevisionnellePct) }}>{pct(r.margePrevisionnellePct)}</td>
                  <td>
                    {r.alerts.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#dc2626', fontSize: 12 }}>
                        <AlertTriangle size={13} />
                        {r.alerts.map((a) => ALERT_LABELS[a] ?? a).join(', ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
        Cliquez un chantier pour ouvrir son détail. <Link href="/chantiers" className="link">Tous les chantiers →</Link>
      </p>
    </div>
  );
}
