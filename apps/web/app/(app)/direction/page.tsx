'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';
import { Alerte, Badge, Bouton, CarteKpi, EtatVide } from '@/components/ui';
import { BarresClassement, Camembert } from '@/components/Graphiques';

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
          <CarteKpi titre="Vente portefeuille" valeur={euro(t.vente)} />
          <CarteKpi
            titre="Réalisé + engagé"
            valeur={euro((Number(t.realise) + Number(t.engage)).toFixed(2))}
          />
          <CarteKpi
            titre="Marge prévisionnelle"
            valeur={euro(t.margePrevisionnelle)}
            ton={Number(t.margePrevisionnelle) < 0 ? 'danger' : 'succes'}
            detail={pct(t.margePrevisionnellePct)}
          />
          <CarteKpi
            titre="Chantiers à risque"
            valeur={`${t.aRisque} / ${t.chantiers}`}
            ton={t.aRisque > 0 ? 'danger' : undefined}
          />
        </div>
      )}

      {portfolio.data && portfolio.data.rows.length > 0 && (
        <div style={{ display: 'grid', gap: 14, marginTop: 16, gridTemplateColumns: 'minmax(300px, 1.3fr) minmax(280px, 1fr)' }}>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Marge prévisionnelle par chantier</h2>
            {/* Rouge dès que la marge passe sous zéro : c'est la seule lecture qui doit sauter
                aux yeux sur cet écran. */}
            <BarresClassement
              parts={portfolio.data.rows.map((r) => ({
                label: r.code,
                valeur: Number(r.margePrevisionnelle ?? 0),
                couleur: Number(r.margePrevisionnelle ?? 0) < 0 ? '#dc2626' : '#15803d',
              }))}
              formatValeur={(v) => euro(v.toFixed(2))}
            />
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Poids des chantiers</h2>
            <Camembert
              parts={portfolio.data.rows.map((r) => ({ label: r.code, valeur: Number(r.vente) }))}
              total={euro(portfolio.data.totals.vente)}
              titre="vente"
            />
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        {portfolio.isLoading && <p className="muted" style={{ padding: 16 }}>Chargement…</p>}
        {portfolio.data && portfolio.data.rows.length === 0 && (
          <EtatVide
            icone={AlertTriangle}
            titre="Aucun chantier à piloter."
            indice="Un chantier apparaît ici dès qu’une affaire gagnée lui est transférée."
          />
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

      <AlertSettings />
    </div>
  );
}

/* ─────────── seuils d'alerte configurables ─────────── */
interface FormulaSet {
  eac_method: 'm1' | 'm2';
  ecart_alert_pct: string;
  marge_cible_pct: string;
}
function AlertSettings() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [ecart, setEcart] = useState<string | null>(null);
  const [marge, setMarge] = useState<string | null>(null);
  const [eac, setEac] = useState<'m1' | 'm2' | null>(null);

  const fs = useQuery({
    queryKey: ['formula-set'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<FormulaSet>('/financial/formula-set', { token }),
  });

  const save = useMutation({
    mutationFn: (body: { ecartAlertPct: number; margeCiblePct: number; eacMethod: 'm1' | 'm2' }) =>
      apiFetch('/financial/formula-set', { method: 'PUT', token, body }),
    onSuccess: () => {
      setErr(null); setSaved(true);
      qc.invalidateQueries({ queryKey: ['formula-set'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  if (fs.isError || !fs.data) return null;
  // Les seuils sont stockés en fraction (-0.05) ; on présente en % (-5).
  const ecartVal = ecart ?? (Number(fs.data.ecart_alert_pct) * 100).toString();
  const margeVal = marge ?? (Number(fs.data.marge_cible_pct) * 100).toString();
  const eacVal = eac ?? fs.data.eac_method;

  return (
    <div className="card" style={{ marginTop: 20, maxWidth: 640 }}>
      <h2 style={{ marginTop: 0 }}>Seuils d’alerte du contrôle de gestion</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Paramètres appliqués à tous les chantiers. Modifiables sans redéploiement ; chaque version est conservée.
      </p>
      {err && <Alerte>{err}</Alerte>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Alerte écart au stade (%)</label>
          <input type="number" step="0.5" value={ecartVal} onChange={(e) => setEcart(e.target.value)} style={{ width: 100, textAlign: 'right' }} />
          <span className="muted" style={{ fontSize: 11 }}>négatif = seuil de dérive (ex. −5)</span>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Marge cible (%)</label>
          <input type="number" step="0.5" value={margeVal} onChange={(e) => setMarge(e.target.value)} style={{ width: 100, textAlign: 'right' }} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Méthode EAC</label>
          <select value={eacVal} onChange={(e) => setEac(e.target.value as 'm1' | 'm2')} style={{ width: 200 }}>
            <option value="m1">Réalisé + reste à dépenser</option>
            <option value="m2">Budget / CPI</option>
          </select>
        </div>
        <Bouton
          chargement={save.isPending}
          libelleChargement="Enregistrement…"
          onClick={() => {
            setErr(null);
            const ecartPct = Number(ecartVal) / 100;
            const margePct = Number(margeVal) / 100;
            if (!Number.isFinite(ecartPct) || !Number.isFinite(margePct)) { setErr('Valeurs invalides'); return; }
            save.mutate({ ecartAlertPct: ecartPct, margeCiblePct: margePct, eacMethod: eacVal });
          }}
        >
          Enregistrer les seuils
        </Bouton>
        {saved && <Badge ton="succes">Enregistré</Badge>}
      </div>
    </div>
  );
}
