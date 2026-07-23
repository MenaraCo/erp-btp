'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';

/* ─────────── types ─────────── */
interface MarcheLine {
  id: string;
  code: string | null;
  designation: string;
  unit: string | null;
  quantite: string;
  pu: string;
  montant_ht: string;
  avenant_id: string | null;
}
interface MarcheDetail {
  marche: { id: string; code: string; name: string; total_ht: string };
  lines: MarcheLine[];
}
interface Situation {
  id: string;
  numero: number;
  revision_coefficient: string;
  retenue_rate: string;
  tva_rate: string;
  montant_periode_ht: string;
  cumul_ht: string;
  tva: string;
  ttc: string;
  retenue_garantie: string;
  nap: string;
}
interface SituationLine {
  marche_line_id: string;
  quantite: string;
  pu: string;
  pct_avancement: string;
  cumul_ht: string;
}
interface SituationDetail { situation: Situation; lines: SituationLine[] }
interface Avenant { id: string; numero: number; label: string; total_ht: string }
interface Dgd {
  montant_marche_ht: string;
  travaux_cumul_ht: string;
  tva: string;
  ttc: string;
  retenue_garantie_totale: string;
  deja_regle_nap: string;
  solde_nap: string;
}

type Tab = 'situations' | 'avenants' | 'dgd';

/** '60' (%) → 0.6 ; '' → null. */
function pctToFraction(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n / 100 : null;
}
function fractionToPct(s: string | number | null | undefined): string {
  if (s == null || s === '') return '—';
  const n = Number(s);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

export default function MarcheDetailPage() {
  const { token } = useAuth();
  const marcheId = String(useParams().marcheId);
  const [tab, setTab] = useState<Tab>('situations');

  const detail = useQuery({
    queryKey: ['marche', marcheId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<MarcheDetail>(`/marches/${marcheId}`, { token }),
  });

  const m = detail.data;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/invoicing" className="link">← Facturation</Link>
      </p>
      {detail.isError && <p className="muted">Marché introuvable ou accès non autorisé.</p>}

      {m && (
        <>
          <h1 style={{ marginBottom: 4 }}>Marché {m.marche.code}</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            {m.marche.name} · Total marché (avenants inclus) <strong>{euro(m.marche.total_ht)}</strong>
          </p>

          <div className="tabs" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginTop: 12 }}>
            <TabButton active={tab === 'situations'} onClick={() => setTab('situations')}>Situations</TabButton>
            <TabButton active={tab === 'avenants'} onClick={() => setTab('avenants')}>Avenants</TabButton>
            <TabButton active={tab === 'dgd'} onClick={() => setTab('dgd')}>DGD</TabButton>
          </div>

          {tab === 'situations' && <SituationsTab marcheId={marcheId} lines={m.lines} token={token} />}
          {tab === 'avenants' && <AvenantsTab marcheId={marcheId} token={token} />}
          {tab === 'dgd' && <DgdTab marcheId={marcheId} token={token} />}
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: 'none',
        background: 'none',
        padding: '8px 14px',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--primary)' : 'var(--muted)',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

/* ═══════════════ Onglet Situations ═══════════════ */
function SituationsTab({ marcheId, lines, token }: { marcheId: string; lines: MarcheLine[]; token: string | null }) {
  const qc = useQueryClient();
  const [pct, setPct] = useState<Record<string, string>>({});
  const [retenue, setRetenue] = useState('5');
  const [tva, setTva] = useState('20');
  const [revision, setRevision] = useState('1');
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const situations = useQuery({
    queryKey: ['situations', marcheId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Situation[]>(`/marches/${marcheId}/situations`, { token }),
  });

  // Dernière situation → cumul + % déjà facturés par ligne (mémoire de l'avancement).
  const lastId = situations.data && situations.data.length > 0
    ? situations.data[situations.data.length - 1].id
    : null;
  const lastDetail = useQuery({
    queryKey: ['situation', lastId],
    enabled: Boolean(token && lastId),
    queryFn: () => apiFetch<SituationDetail>(`/situations/${lastId}`, { token }),
  });
  const prevByLine = useMemo(() => {
    const map = new Map<string, { cumul: number; pct: number }>();
    for (const l of lastDetail.data?.lines ?? []) {
      map.set(l.marche_line_id, { cumul: Number(l.cumul_ht), pct: Number(l.pct_avancement) });
    }
    return map;
  }, [lastDetail.data]);

  const revisionNum = Number(revision.replace(',', '.')) || 1;

  // Aperçu du montant période par ligne et au total, en direct.
  // On arrondit le cumul à 2 décimales comme le moteur backend, pour éviter tout
  // écart de centime lorsqu'on reconduit un cumul déjà arrondi.
  const preview = useMemo(() => {
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    let totalPeriode = 0;
    const perLine = new Map<string, number>();
    for (const l of lines) {
      const prev = prevByLine.get(l.id)?.cumul ?? 0;
      const frac = pctToFraction(pct[l.id] ?? '');
      const effFrac = frac ?? prevByLine.get(l.id)?.pct ?? 0;
      const newCumul = round2(Number(l.quantite) * Number(l.pu) * effFrac * revisionNum);
      const periode = round2(newCumul - prev);
      perLine.set(l.id, periode);
      totalPeriode += periode;
    }
    return { perLine, totalPeriode: round2(totalPeriode) };
  }, [lines, pct, prevByLine, revisionNum]);

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/marches/${marcheId}/situations`, {
        method: 'POST',
        token,
        body: {
          retenueRate: String((pctToFraction(retenue) ?? 0)),
          tvaRate: String((pctToFraction(tva) ?? 0.2)),
          revisionCoefficient: String(revisionNum),
          lines: lines.map((l) => ({
            marcheLineId: l.id,
            // % cumulé : valeur saisie, sinon on reconduit le cumul précédent de la ligne
            pctAvancement: String(pctToFraction(pct[l.id] ?? '') ?? prevByLine.get(l.id)?.pct ?? 0),
          })),
        },
      }),
    onSuccess: () => {
      setErr(null);
      setPct({});
      qc.invalidateQueries({ queryKey: ['situations', marcheId] });
      qc.invalidateQueries({ queryKey: ['dgd', marcheId] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const nextNumero = (situations.data?.length ?? 0) + 1;

  return (
    <div>
      {/* liste des situations existantes, dépliables ligne par ligne */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Situations {situations.data ? `(${situations.data.length})` : ''}</h2>
        {situations.data && situations.data.length > 0 ? (
          <table className="grid">
            <thead>
              <tr>
                <th></th>
                <th>N°</th>
                <th style={{ textAlign: 'right' }}>Période HT</th>
                <th style={{ textAlign: 'right' }}>Cumul HT</th>
                <th style={{ textAlign: 'right' }}>Révision</th>
                <th style={{ textAlign: 'right' }}>TVA</th>
                <th style={{ textAlign: 'right' }}>TTC</th>
                <th style={{ textAlign: 'right' }}>Retenue</th>
                <th style={{ textAlign: 'right' }}>Net à payer</th>
              </tr>
            </thead>
            <tbody>
              {situations.data.map((s) => (
                <SituationRows
                  key={s.id}
                  s={s}
                  lines={lines}
                  token={token}
                  expanded={expanded === s.id}
                  onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                />
              ))}
            </tbody>
          </table>
        ) : <p className="muted">Aucune situation. Renseignez les avancements ci-dessous et créez la première.</p>}
      </div>

      {/* création enrichie de la situation suivante */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Nouvelle situation (n° {nextNumero})</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Saisissez l'avancement <strong>cumulé</strong> de chaque ligne (0 à 100 %). Le montant de la période est
          la différence avec ce qui a déjà été facturé. Les lignes d'avenant sont incluses.
        </p>
        {err && <div className="error">{err}</div>}
        {lines.length === 0 ? (
          <p className="muted">Ce marché n'a pas de lignes facturables.</p>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); setErr(null); create.mutate(); }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Ligne</th>
                    <th style={{ textAlign: 'right' }}>Montant marché</th>
                    <th style={{ textAlign: 'right' }}>Déjà facturé</th>
                    <th style={{ textAlign: 'right' }}>Avanc. cumulé (%)</th>
                    <th style={{ textAlign: 'right' }}>Montant période</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const prev = prevByLine.get(l.id);
                    const periode = preview.perLine.get(l.id) ?? 0;
                    return (
                      <tr key={l.id}>
                        <td>
                          {l.code ? <strong>{l.code} </strong> : null}{l.designation}
                          {l.avenant_id && <span className="badge" style={{ marginLeft: 6, fontSize: 10 }}>avenant</span>}
                          <div className="muted" style={{ fontSize: 11 }}>{l.quantite} {l.unit ?? ''} × {euro(l.pu)}</div>
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(l.montant_ht)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {prev ? (
                            <>
                              <div style={{ fontVariantNumeric: 'tabular-nums' }}>{euro(prev.cumul)}</div>
                              <div className="muted" style={{ fontSize: 11 }}>{fractionToPct(prev.pct)}</div>
                            </>
                          ) : <span className="muted">—</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number" min={0} max={100} step={1}
                            style={{ width: 80, textAlign: 'right' }}
                            value={pct[l.id] ?? ''}
                            placeholder={prev ? String(Math.round(prev.pct * 100)) : '0'}
                            onChange={(e) => setPct({ ...pct, [l.id]: e.target.value })}
                          />
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: periode < 0 ? 'var(--danger)' : undefined }}>
                          {euro(periode)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td colSpan={4} style={{ textAlign: 'right', fontWeight: 600 }}>Montant période HT (aperçu)</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{euro(preview.totalPeriode)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Coefficient de révision</label>
                <input style={{ width: 90, textAlign: 'right' }} value={revision} onChange={(e) => setRevision(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Retenue de garantie (%)</label>
                <input type="number" step="0.5" style={{ width: 90, textAlign: 'right' }} value={retenue} onChange={(e) => setRetenue(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>TVA (%)</label>
                <input type="number" step="0.5" style={{ width: 90, textAlign: 'right' }} value={tva} onChange={(e) => setTva(e.target.value)} />
              </div>
              <button className="btn" type="submit" disabled={create.isPending}>
                {create.isPending ? 'Calcul…' : `Créer la situation n° ${nextNumero}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Ligne de situation dépliable montrant l'avancement ligne par ligne. */
function SituationRows({
  s, lines, token, expanded, onToggle,
}: {
  s: Situation; lines: MarcheLine[]; token: string | null; expanded: boolean; onToggle: () => void;
}) {
  const detail = useQuery({
    queryKey: ['situation', s.id],
    enabled: Boolean(token && expanded),
    queryFn: () => apiFetch<SituationDetail>(`/situations/${s.id}`, { token }),
  });
  const lineLabel = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);

  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td style={{ width: 24, textAlign: 'center', color: 'var(--muted)' }}>{expanded ? '▾' : '▸'}</td>
        <td><strong>{s.numero}</strong></td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(s.montant_periode_ht)}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(s.cumul_ht)}</td>
        <td style={{ textAlign: 'right' }}>{Number(s.revision_coefficient).toLocaleString('fr-FR', { maximumFractionDigits: 4 })}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(s.tva)}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(s.ttc)}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(s.retenue_garantie)}</td>
        <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{euro(s.nap)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} style={{ background: 'var(--bg)', padding: 0 }}>
            {detail.isLoading && <p className="muted" style={{ padding: 12 }}>Chargement du détail…</p>}
            {detail.data && (
              <table className="grid" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 24 }}>Ligne</th>
                    <th style={{ textAlign: 'right' }}>Qté × PU</th>
                    <th style={{ textAlign: 'right' }}>Avancement cumulé</th>
                    <th style={{ textAlign: 'right' }}>Cumul HT ligne</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.lines.map((dl) => {
                    const ref = lineLabel.get(dl.marche_line_id);
                    return (
                      <tr key={dl.marche_line_id} className="muted">
                        <td style={{ paddingLeft: 24 }}>{ref ? `${ref.code ? ref.code + ' ' : ''}${ref.designation}` : dl.marche_line_id.slice(0, 8)}</td>
                        <td style={{ textAlign: 'right' }}>{dl.quantite} × {euro(dl.pu)}</td>
                        <td style={{ textAlign: 'right' }}>{fractionToPct(dl.pct_avancement)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(dl.cumul_ht)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/* ═══════════════ Onglet Avenants ═══════════════ */
interface DraftLine { designation: string; unit: string; quantite: string; pu: string }
const emptyLine = (): DraftLine => ({ designation: '', unit: '', quantite: '', pu: '' });

function AvenantsTab({ marcheId, token }: { marcheId: string; token: string | null }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [draft, setDraft] = useState<DraftLine[]>([emptyLine()]);
  const [err, setErr] = useState<string | null>(null);

  const avenants = useQuery({
    queryKey: ['avenants', marcheId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Avenant[]>(`/marches/${marcheId}/avenants`, { token }),
  });

  const total = useMemo(
    () => draft.reduce((sum, l) => sum + (Number(l.quantite) || 0) * (Number(l.pu) || 0), 0),
    [draft],
  );

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/marches/${marcheId}/avenants`, {
        method: 'POST',
        token,
        body: {
          label: label.trim() || undefined,
          lines: draft
            .filter((l) => l.designation.trim() !== '')
            .map((l) => ({
              designation: l.designation.trim(),
              unit: l.unit.trim() || null,
              quantite: l.quantite || '0',
              pu: l.pu || '0',
            })),
        },
      }),
    onSuccess: () => {
      setErr(null);
      setLabel('');
      setDraft([emptyLine()]);
      qc.invalidateQueries({ queryKey: ['avenants', marcheId] });
      qc.invalidateQueries({ queryKey: ['marche', marcheId] }); // le total marché a changé
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const canSubmit = draft.some((l) => l.designation.trim() !== '');

  return (
    <div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Avenants {avenants.data ? `(${avenants.data.length})` : ''}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Un avenant ajoute des lignes au marché (travaux supplémentaires ou en moins) et augmente le montant du
          marché. Ces lignes entrent automatiquement dans les situations suivantes.
        </p>
        {avenants.data && avenants.data.length > 0 ? (
          <table className="grid">
            <thead>
              <tr>
                <th>N°</th>
                <th>Libellé</th>
                <th style={{ textAlign: 'right' }}>Montant HT</th>
              </tr>
            </thead>
            <tbody>
              {avenants.data.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.numero}</strong></td>
                  <td>{a.label}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: Number(a.total_ht) < 0 ? 'var(--danger)' : undefined }}>{euro(a.total_ht)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">Aucun avenant.</p>}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Nouvel avenant</h2>
        {err && <div className="error">{err}</div>}
        <div className="field" style={{ maxWidth: 360 }}>
          <label>Libellé (optionnel)</label>
          <input value={label} placeholder="Travaux modificatifs…" onChange={(e) => setLabel(e.target.value)} />
        </div>
        <table className="grid" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Désignation</th>
              <th style={{ width: 70 }}>Unité</th>
              <th style={{ textAlign: 'right', width: 90 }}>Qté</th>
              <th style={{ textAlign: 'right', width: 110 }}>PU HT</th>
              <th style={{ textAlign: 'right', width: 120 }}>Montant</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {draft.map((l, i) => (
              <tr key={i}>
                <td>
                  <input
                    style={{ width: '100%' }}
                    value={l.designation}
                    placeholder="Travaux supplémentaires"
                    onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, designation: e.target.value } : x)))}
                  />
                </td>
                <td>
                  <input style={{ width: 60 }} value={l.unit} placeholder="U" onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input type="number" step="any" style={{ width: 80, textAlign: 'right' }} value={l.quantite} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, quantite: e.target.value } : x)))} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input type="number" step="any" style={{ width: 100, textAlign: 'right' }} value={l.pu} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, pu: e.target.value } : x)))} />
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {euro((Number(l.quantite) || 0) * (Number(l.pu) || 0))}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {draft.length > 1 && (
                    <button type="button" className="btn btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setDraft(draft.filter((_, j) => j !== i))}>×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td colSpan={4} style={{ textAlign: 'right', fontWeight: 600 }}>Total avenant HT</td>
              <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{euro(total)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setDraft([...draft, emptyLine()])}>+ Ligne</button>
          <button type="button" className="btn" disabled={!canSubmit || create.isPending} onClick={() => { setErr(null); create.mutate(); }}>
            {create.isPending ? 'Création…' : 'Créer l\'avenant'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Astuce : pour un travaux en moins, saisissez une quantité ou un PU négatif.
        </p>
      </div>
    </div>
  );
}

/* ═══════════════ Onglet DGD ═══════════════ */
function DgdTab({ marcheId, token }: { marcheId: string; token: string | null }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const dgd = useQuery({
    queryKey: ['dgd', marcheId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Dgd>(`/marches/${marcheId}/dgd`, { token }),
  });

  const generate = useMutation({
    mutationFn: () => apiFetch(`/marches/${marcheId}/dgd`, { method: 'POST', token }),
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ['dgd', marcheId] }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const d = dgd.data;
  const notFound = dgd.isError && dgd.error instanceof ApiError && dgd.error.status === 404;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>Décompte général définitif (DGD)</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Le DGD solde le marché à partir de la dernière situation : travaux cumulés, retenues de garantie totales et
        ce qui a déjà été réglé, pour obtenir le solde final.
      </p>
      {err && <div className="error">{err}</div>}
      {dgd.isError && !notFound && <p className="muted">Accès au DGD non autorisé.</p>}
      {notFound && <p className="muted">Pas encore de DGD. Générez-le une fois la dernière situation établie.</p>}

      {d && (
        <table className="grid" style={{ maxWidth: 480 }}>
          <tbody>
            <DgdRow label="Montant du marché HT" value={d.montant_marche_ht} />
            <DgdRow label="Travaux cumulés HT" value={d.travaux_cumul_ht} />
            <DgdRow label="TVA" value={d.tva} />
            <DgdRow label="TTC" value={d.ttc} />
            <DgdRow label="Retenue de garantie totale" value={d.retenue_garantie_totale} />
            <DgdRow label="Déjà réglé (net)" value={d.deja_regle_nap} />
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td><strong>Solde net à payer</strong></td>
              <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{euro(d.solde_nap)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 12 }}>
        <button className="btn" disabled={generate.isPending} onClick={() => { setErr(null); generate.mutate(); }}>
          {generate.isPending ? 'Génération…' : d ? 'Régénérer le DGD' : 'Générer le DGD'}
        </button>
      </div>
    </div>
  );
}

function DgdRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td>{label}</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(value)}</td>
    </tr>
  );
}
