'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { euro } from '@/lib/format';
import { downloadStyledXlsx, SheetCell, StyleKey } from '@/lib/xlsx';

interface DevisTotals { debourse: string; revient: string; pvHt: string; margeNette: string; margeNettePct: string }
interface DevisRow {
  id: string; numero: string | null; designation: string | null; status: string;
  affaire_code: string; affaire_name: string; created_at: string | null;
  totals: DevisTotals | null;
}

const STATUS_LABEL: Record<string, string> = {
  won: 'Gagné', lost: 'Perdu', sent: 'Envoyé',
  open: 'En cours', followup: 'Relancé', revision: 'Révision',
};
const badgeClass = (s: string) =>
  s === 'won' ? 'badge success' : s === 'lost' ? 'badge danger' : s === 'sent' ? 'badge info' : 'badge';
const pv = (d: DevisRow) => Number(d.totals?.pvHt ?? 0);
const deb = (d: DevisRow) => Number(d.totals?.debourse ?? 0);

interface Echeance {
  id: string; code: string; name: string; status: string; close: boolean;
  date_limite_remise: string | null;
  delai: { etat: 'sans_echeance' | 'a_lheure' | 'avance' | 'depasse'; jours: number | null; rendu: boolean };
}

export default function DashboardPage() {
  const { token } = useAuth();
  // Échéances : mêmes données et MÊME règle de délai que le planning — un retard annoncé ici doit
  // se retrouver là-bas à l'identique.
  const planningQ = useQuery({
    queryKey: ['affaires-planning'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ affaires: Echeance[] }>('/affaires-planning', { token }),
  });
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>Tableau de bord</h1>
          <p className="muted" style={{ marginTop: 0 }}>Études de prix — synthèse commerciale et financière.</p>
        </div>
        <button type="button" className="btn-secondary" disabled={loading}
          onClick={() => exportSynthese(devis, {
            caAccepte, deboursAccepte, caPrevisionnel, caMois, tauxTransfo,
            won: won.length, sent: sent.length, drafts: drafts.length, lost: lost.length,
          })}>
          Export synthèse (Excel)
        </button>
      </div>

      {/* KPI financiers */}
      <div style={kpiGrid}>
        <KpiCard label="CA gagné (total)" value={euro(caAccepte)} accent
          sub={`Déboursé ${euro(deboursAccepte)}`} loading={loading} />
        <KpiCard label="CA prévisionnel" value={euro(caPrevisionnel)}
          sub={`${sent.length} devis envoyé(s)`} loading={loading} />
        <KpiCard label="CA ce mois" value={euro(caMois)}
          sub={`${nbMois} devis créé(s)`} loading={loading} />
        <KpiCard label="Taux de transformation" value={`${tauxTransfo} %`} good
          sub={`${won.length} gagné(s) / ${devis.length} total`} loading={loading} />
        <KpiCard label="Clients" value={clientsQ.data?.total ?? '—'} sub="Référentiel" loading={clientsQ.isLoading} />
      </div>

      {/* Devis par statut */}
      <div className="form-section-title" style={{ marginTop: 24 }}>Devis par statut</div>
      <div style={statusGrid}>
        <StatusTile n={drafts.length} label="Brouillons" color="#64748b" />
        <StatusTile n={sent.length} label="Envoyés" color="#2563eb" />
        <StatusTile n={won.length} label="Gagnés" color="#16a34a" />
        <StatusTile n={lost.length} label="Refusés" color="#dc2626" />
      </div>

      {/* Prochaines échéances : ce qui doit sortir, et ce qui aurait dû sortir. */}
      <Echeances affaires={planningQ.data?.affaires ?? []} />

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

/**
 * Prochaines échéances de remise. Les retards passent EN TÊTE : un tableau de bord sert à voir ce
 * qui ne va pas, pas à faire défiler ce qui va bien. Les affaires closes et celles déjà remises
 * n'y figurent pas — elles n'attendent plus rien.
 */
function Echeances({ affaires }: { affaires: Echeance[] }) {
  const attendues = affaires
    .filter((a) => a.date_limite_remise && !a.close && !a.delai.rendu)
    .sort((x, y) => (x.date_limite_remise! < y.date_limite_remise! ? -1 : 1));
  const enRetard = attendues.filter((a) => a.delai.etat === 'depasse').length;

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div className="form-section-title" style={{ margin: 0 }}>Prochaines échéances</div>
        {enRetard > 0 && <span className="badge danger">{enRetard} en retard</span>}
      </div>
      {attendues.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Aucune remise attendue. Les échéances se posent sur la fiche de l’affaire.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attendues.slice(0, 6).map((a) => {
            const retard = a.delai.etat === 'depasse';
            const j = a.delai.jours ?? 0;
            return (
              <Link key={a.id} href={`/estimating/${a.id}`} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8,
                border: `1px solid ${retard ? '#fecaca' : 'var(--border)'}`,
                background: retard ? '#fef2f2' : '#fff', textDecoration: 'none', color: 'inherit',
              }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 12.5 }}>
                    <span className="code-cell">{a.code}</span> {a.name}
                  </span>
                  <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                    {new Date(`${a.date_limite_remise}T12:00:00`).toLocaleDateString('fr-FR')}
                  </span>
                </span>
                <span className={retard ? 'badge danger' : 'badge'}>
                  {retard ? `J+${-j}` : `J−${j}`}
                </span>
              </Link>
            );
          })}
          {attendues.length > 6 && (
            <Link className="link" href="/estimating/planning" style={{ fontSize: 11 }}>
              Voir les {attendues.length} échéances →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** Synthèse commerciale du moment, en tableur : les chiffres du bandeau puis le détail des devis. */
function exportSynthese(
  devis: DevisRow[],
  k: {
    caAccepte: number; deboursAccepte: number; caPrevisionnel: number; caMois: number;
    tauxTransfo: string | number; won: number; sent: number; drafts: number; lost: number;
  },
) {
  const rows: SheetCell[][] = [
    [{ v: 'Synthèse des études de prix', s: 'title' }],
    [{ v: `Éditée le ${new Date().toLocaleDateString('fr-FR')}`, s: 'subtitle' }],
    [],
    [{ v: 'Indicateur', s: 'header' }, { v: 'Valeur', s: 'header' }],
    [{ v: 'CA gagné (total)', s: 'value' }, { v: k.caAccepte, s: 'money' }],
    [{ v: 'Déboursé des devis gagnés', s: 'value' }, { v: k.deboursAccepte, s: 'money' }],
    [{ v: 'CA prévisionnel (devis envoyés)', s: 'value' }, { v: k.caPrevisionnel, s: 'money' }],
    [{ v: 'CA du mois', s: 'value' }, { v: k.caMois, s: 'money' }],
    [{ v: 'Taux de transformation (%)', s: 'value' }, { v: Number(k.tauxTransfo), s: 'qty' }],
    [{ v: 'Devis gagnés', s: 'value' }, { v: k.won, s: 'qty' }],
    [{ v: 'Devis envoyés', s: 'value' }, { v: k.sent, s: 'qty' }],
    [{ v: 'Devis en cours', s: 'value' }, { v: k.drafts, s: 'qty' }],
    [{ v: 'Devis perdus', s: 'value' }, { v: k.lost, s: 'qty' }],
    [],
    ['Numéro', 'Affaire', 'Désignation', 'Statut', 'Déboursé', 'Total HT', 'Marge nette']
      .map((h) => ({ v: h, s: 'header' as StyleKey })),
  ];
  for (const d of devis) {
    rows.push([
      { v: d.numero ?? '', s: 'num' },
      { v: `${d.affaire_code} — ${d.affaire_name}`, s: 'text' },
      { v: d.designation ?? '', s: 'text' },
      { v: STATUS_LABEL[d.status] ?? d.status, s: 'text' },
      { v: Number(d.totals?.debourse ?? 0), s: 'money' },
      { v: Number(d.totals?.pvHt ?? 0), s: 'money' },
      { v: Number(d.totals?.margeNette ?? 0), s: 'money' },
    ]);
  }
  downloadStyledXlsx(`Synthese_etudes_${new Date().toISOString().slice(0, 10)}`, rows, {
    sheetName: 'Synthèse',
    cols: [16, 34, 40, 14, 15, 15, 15],
    merges: ['A1:G1', 'A2:G2'],
    freezeRows: 15,
  });
}
