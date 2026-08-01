'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro, percent } from '@/lib/format';

const NATURE_LABELS: Record<string, string> = {
  material: 'Matériaux',
  equipment: 'Matériel',
  subcontract: 'Sous-traitance',
  labor: "Main d'œuvre",
  site_overhead: 'Frais de chantier',
};

interface NatureResult {
  nature: string;
  budgetObjectif: string;
  engage: string;
  realise: string;
  ecart: string;
}
interface Results {
  budgetVenteHt: string | null;
  byNature: NatureResult[];
  totals: { budgetObjectif: string; engage: string; realise: string; ecart: string };
}
interface Marche {
  id: string;
  code: string;
  name: string;
  total_ht: string;
  contre_etude_status: string;
}

type Metrics = Record<string, string>;
interface Code {
  id: string;
  code: string;
  label: string;
  metrics: Metrics;
}
interface Famille {
  id: string;
  code: string;
  label: string;
  metrics: Metrics;
  codes: Code[];
}
interface Lot {
  id: string;
  code: string;
  label: string;
  metrics: Metrics;
  familles: Famille[];
}
interface AnalyticalNature {
  nature: string;
  label: string;
  metrics: Metrics;
  lots: Lot[];
}
interface AVentilerResource {
  id: string;
  code: string;
  label: string;
  unit: string | null;
  nature: string;
  unit_cost_objectif: string;
  marche_code: string;
}
interface AnalyticalResults {
  natures: AnalyticalNature[];
  aVentiler: { code: string; label: string; metrics: Metrics; resources: AVentilerResource[] };
  siteOverhead: { label: string; metrics: Metrics };
  total: Metrics;
}
interface PlanCode { id: string; code: string; label: string }
interface PlanFamille { id: string; code: string; label: string; codes: PlanCode[] }
interface PlanLot { id: string; code: string; label: string; familles: PlanFamille[] }
interface PlanNature { nature: string; label: string; lots: PlanLot[] }
interface Forecast {
  avancement: string;
  indicators: {
    budgetAvance: string;
    ecartAuStade: string;
    eac: string | null;
    margePrevisionnelle: string | null;
    margePrevisionnellePct: string | null;
    alerts: string[];
  };
}

function MetricCells({ m }: { m: Metrics }) {
  return (
    <>
      <td style={{ textAlign: 'right' }}>{euro(m.budgetObjectif)}</td>
      <td style={{ textAlign: 'right' }}>{euro(m.engage)}</td>
      <td style={{ textAlign: 'right' }}>{euro(m.realise)}</td>
    </>
  );
}

function hasValue(m: Metrics): boolean {
  return ['budgetObjectif', 'engage', 'realise'].some((k) => Number(m[k] ?? 0) !== 0);
}

export default function ChantierDetailPage() {
  const { token } = useAuth();
  const params = useParams();
  const chantierId = String(params.chantierId);

  const chantier = useQuery({
    queryKey: ['chantier', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ code: string }>(`/chantiers/${chantierId}`, { token }),
  });
  const results = useQuery({
    queryKey: ['chantier-results', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Results>(`/chantiers/${chantierId}/results`, { token }),
  });
  const marches = useQuery({
    queryKey: ['chantier-marches', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Marche[]>(`/chantiers/${chantierId}/marches`, { token }),
  });
  const analytical = useQuery({
    queryKey: ['chantier-analytical', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<AnalyticalResults>(`/chantiers/${chantierId}/analytical-results`, { token }),
  });
  const forecast = useQuery({
    queryKey: ['chantier-forecast', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Forecast>(`/chantiers/${chantierId}/forecast`, { token }),
  });

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/chantiers" className="link">
          ← Chantiers
        </Link>
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 4 }}>Chantier {chantier.data?.code ?? ''}</h1>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <Link href={`/chantiers/${chantierId}/structure`} className="btn btn-secondary">Structure & budget</Link>
          <Link href={`/chantiers/${chantierId}/pointages`} className="btn btn-secondary">Pointages</Link>
          <Link href={`/chantiers/${chantierId}/achats`} className="btn btn-secondary">Achats</Link>
          <Link href={`/chantiers/${chantierId}/avancement`} className="btn btn-secondary">Avancement</Link>
          <Link href={`/chantiers/${chantierId}/mensuel`} className="btn btn-secondary">Gestion mensuelle</Link>
          <Link href={`/chantiers/${chantierId}/pilotage`} className="btn btn-secondary">Pilotage</Link>
        </div>
      </div>

      {results.data && (
        <div className="card-grid" style={{ marginTop: 12 }}>
          <div className="card">
            <h2>Budget de vente</h2>
            <div className="stat">{euro(results.data.budgetVenteHt)}</div>
          </div>
          <div className="card">
            <h2>Budget objectif</h2>
            <div className="stat">{euro(results.data.totals.budgetObjectif)}</div>
          </div>
          <div className="card">
            <h2>Engagé</h2>
            <div className="stat">{euro(results.data.totals.engage)}</div>
          </div>
          <div className="card">
            <h2>Réalisé</h2>
            <div className="stat">{euro(results.data.totals.realise)}</div>
          </div>
          <div className="card">
            <h2>Écart au budget</h2>
            <div className="stat" style={{ color: Number(results.data.totals.ecart) < 0 ? 'var(--danger)' : undefined }}>
              {euro(results.data.totals.ecart)}
            </div>
          </div>
        </div>
      )}
      {results.isError && <p className="muted">Suivi de chantiers non autorisé pour cet utilisateur.</p>}

      {forecast.data && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ margin: 0 }}>Prévisionnel (Gestion financière)</h2>
            <span className="muted">Avancement {percent(forecast.data.avancement)}</span>
          </div>
          <div className="card-grid" style={{ marginTop: 12 }}>
            <div className="card">
              <h2>Marge prévisionnelle</h2>
              <div
                className="stat"
                style={{ color: Number(forecast.data.indicators.margePrevisionnelle ?? 0) < 0 ? 'var(--danger)' : undefined }}
              >
                {euro(forecast.data.indicators.margePrevisionnelle)}
              </div>
              <div className="muted">{percent(forecast.data.indicators.margePrevisionnellePct)}</div>
            </div>
            <div className="card">
              <h2>Coût final estimé (EAC)</h2>
              <div className="stat">{euro(forecast.data.indicators.eac)}</div>
            </div>
            <div className="card">
              <h2>Budget avancé</h2>
              <div className="stat">{euro(forecast.data.indicators.budgetAvance)}</div>
            </div>
            <div className="card">
              <h2>Écart au stade</h2>
              <div
                className="stat"
                style={{ color: Number(forecast.data.indicators.ecartAuStade) < 0 ? 'var(--danger)' : undefined }}
              >
                {euro(forecast.data.indicators.ecartAuStade)}
              </div>
            </div>
          </div>
          {forecast.data.indicators.alerts.length > 0 && (
            <p style={{ color: 'var(--danger)', marginBottom: 0 }}>
              ⚠ Alertes : {forecast.data.indicators.alerts.join(', ')}
            </p>
          )}
        </div>
      )}

      {marches.data && marches.data.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Marchés du chantier ({marches.data.length})</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Un chantier agrège plusieurs marchés ; la facturation est propre à chaque marché (§5.5).
          </p>
          <table className="grid">
            <thead>
              <tr>
                <th>Code</th>
                <th>Désignation</th>
                <th>Contre-étude</th>
                <th style={{ textAlign: 'right' }}>Montant vente HT</th>
              </tr>
            </thead>
            <tbody>
              {marches.data.map((m) => (
                <tr key={m.id}>
                  <td>{m.code}</td>
                  <td>{m.name}</td>
                  <td className="muted">
                    {m.contre_etude_status === 'validated' ? 'validée' : 'en cours'}
                  </td>
                  <td style={{ textAlign: 'right' }}>{euro(m.total_ht)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Gestion financière — axe analytique</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Budget / engagé / réalisé ventilés par nature → lot → famille (§5.8).
        </p>
        {analytical.isLoading && <p className="muted">Chargement…</p>}
        {analytical.isError && (
          <p className="muted">Module « Gestion financière » non actif pour cet utilisateur.</p>
        )}
        {analytical.data && (
          <table className="grid">
            <thead>
              <tr>
                <th>Poste</th>
                <th style={{ textAlign: 'right' }}>Budget objectif</th>
                <th style={{ textAlign: 'right' }}>Engagé</th>
                <th style={{ textAlign: 'right' }}>Réalisé</th>
              </tr>
            </thead>
            <tbody>
              {analytical.data.natures.map((n) => (
                <NatureRows key={n.nature} nature={n} />
              ))}
              {hasValue(analytical.data.aVentiler.metrics) && (
                <tr>
                  <td>
                    <strong>
                      <span className="code-cell">{analytical.data.aVentiler.code}</span>{' '}
                      {analytical.data.aVentiler.label}
                    </strong>
                  </td>
                  <MetricCells m={analytical.data.aVentiler.metrics} />
                </tr>
              )}
              <tr>
                <td>
                  <strong>{analytical.data.siteOverhead.label}</strong>
                </td>
                <MetricCells m={analytical.data.siteOverhead.metrics} />
              </tr>
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td>
                  <strong>Total chantier</strong>
                </td>
                <MetricCells m={analytical.data.total} />
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {analytical.data && (
        <AVentilerCard
          chantierId={chantierId}
          data={analytical.data.aVentiler}
          onVentiled={() => analytical.refetch()}
        />
      )}
    </div>
  );
}

function NatureRows({ nature }: { nature: AnalyticalNature }) {
  return (
    <>
      <tr style={{ background: 'var(--bg)' }}>
        <td>
          <strong>{NATURE_LABELS[nature.nature] ?? nature.label}</strong>
        </td>
        <MetricCells m={nature.metrics} />
      </tr>
      {nature.lots.filter((l) => hasValue(l.metrics)).map((lot) => (
        <Fragment key={lot.id}>
          <tr>
            <td style={{ paddingLeft: 24 }}>{lot.label}</td>
            <MetricCells m={lot.metrics} />
          </tr>
          {lot.familles.filter((f) => hasValue(f.metrics)).map((fam) => (
            <Fragment key={fam.id}>
              <tr>
                <td style={{ paddingLeft: 44 }}>{fam.label}</td>
                <MetricCells m={fam.metrics} />
              </tr>
              {fam.codes.filter((c) => hasValue(c.metrics)).map((code) => (
                <tr key={code.id} className="muted">
                  <td style={{ paddingLeft: 64 }}>
                    {code.code} · {code.label}
                  </td>
                  <MetricCells m={code.metrics} />
                </tr>
              ))}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  );
}

/**
 * « 999 — À ventiler » : tout ce qui n'a pas de code analytique, toutes natures confondues. On y
 * range les ressources chiffrées sans code plutôt que de les glisser d'office dans une nature —
 * et le conducteur les classe ici même, sans quitter son chantier.
 */
function AVentilerCard({
  chantierId,
  data,
  onVentiled,
}: {
  chantierId: string;
  data: AnalyticalResults['aVentiler'];
  onVentiled: () => void;
}) {
  const { token } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const plan = useQuery({
    queryKey: ['analytical-plan'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<PlanNature[]>('/analytical/plan', { token }),
  });
  const ventile = useMutation({
    mutationFn: ({ resourceId, codeId }: { resourceId: string; codeId: string }) =>
      apiFetch(`/chantiers/${chantierId}/nomenclature/${resourceId}/code-analytique`, {
        method: 'PUT',
        body: { codeAnalytiqueId: codeId },
        token,
      }),
    onSuccess: () => { setError(null); onVentiled(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ventilation impossible.'),
  });

  if (data.resources.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>
        <span className="code-cell">{data.code}</span> {data.label}
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Ces ressources sont arrivées du devis sans code analytique. Tant qu’elles restent ici, elles
        ne comptent dans aucune nature : rangez-les dans le code qui convient.
      </p>
      {error && <div className="error">{error}</div>}
      <table className="grid">
        <thead>
          <tr>
            <th>Ressource</th>
            <th>Marché</th>
            <th style={{ textAlign: 'right' }}>PU objectif</th>
            <th style={{ width: 280 }}>Code analytique</th>
          </tr>
        </thead>
        <tbody>
          {data.resources.map((r) => (
            <tr key={r.id}>
              <td>
                {r.code ? <span className="code-cell">{r.code}</span> : null} {r.label}{' '}
                <span className="muted">({NATURE_LABELS[r.nature] ?? r.nature})</span>
              </td>
              <td className="muted">{r.marche_code}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {euro(r.unit_cost_objectif)}
              </td>
              <td>
                <select
                  defaultValue=""
                  disabled={ventile.isPending || !plan.data}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    if (e.target.value) ventile.mutate({ resourceId: r.id, codeId: e.target.value });
                  }}
                >
                  <option value="">— choisir un code —</option>
                  {(plan.data ?? []).map((n) => (
                    <optgroup key={n.nature} label={NATURE_LABELS[n.nature] ?? n.label}>
                      {n.lots.flatMap((lot) =>
                        lot.familles.flatMap((fam) =>
                          fam.codes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.code} · {c.label} ({fam.label})
                            </option>
                          )),
                        ),
                      )}
                    </optgroup>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
