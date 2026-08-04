'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS, euro } from '@/lib/format';
import { IconBtn } from '@/components/IconBtn';

interface Kpis {
  debourse: string; revient: string; pvHt: string; margeBrute: string; margeNette: string;
}
interface DevisRow {
  id: string; numero: string | null; designation: string; type: string; status: string;
  versions: { id: string; version_no: number }[];
  kpis: Kpis | null;
}
interface Lieu {
  adresse?: string; code_postal?: string; ville?: string; pays?: string;
}
interface AffaireDetail {
  affaire: {
    id: string; code: string; name: string; status: string; moa: string | null;
    lieu_execution: Lieu | null; budget_objectif: string | null; responsable: string | null; notes: string | null;
    date_limite_remise: string | null; date_retour_effectif: string | null;
    date_debut_etudes: string | null; date_fin_etudes: string | null;
    conducteur: string | null; date_debut_travaux: string | null; date_fin_travaux: string | null;
  };
  devis: DevisRow[];
  totals: Kpis;
  /** Chantier né de cette affaire, s'il existe : la fiche doit y mener. */
  chantier: { id: string; code: string; name: string } | null;
  /** Réel constaté sur ce chantier. Absent tant qu'il n'y a pas de chantier. */
  reel: { coutReel: string; margeReelle: string } | null;
}

/** Libellés du statut DÉRIVÉ de l'affaire (calculé depuis ses devis). */
const AFFAIRE_DERIVED_LABELS: Record<string, string> = {
  en_cours: 'En cours', gagnee_partielle: 'Gagnée partiellement', gagnee: 'Gagnée', perdue: 'Perdue',
};
const DEVIS_TYPE_LABELS: Record<string, string> = { principal: 'Principal', lot: 'Lot', avenant: 'Avenant' };
/** badge variant for a derived affaire status */
const affaireBadge = (s: string) =>
  s === 'gagnee' ? 'badge success' : s === 'perdue' ? 'badge danger' : s === 'gagnee_partielle' ? 'badge info' : 'badge';
/** badge variant for a devis workflow status */
const devisBadge = (s: string) =>
  s === 'won' ? 'badge success' : s === 'lost' ? 'badge danger' : s === 'sent' ? 'badge info' : 'badge';

export default function AffaireDetailPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const affaireId = String(useParams().affaireId);
  const [err, setErr] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['affaire', affaireId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<AffaireDetail>(`/affaires/${affaireId}`, { token }),
  });

  // --- métadonnées affaire ---
  const [meta, setMeta] = useState({
    responsable: '', budget: '', adresse: '', cp: '', ville: '', notes: '',
    // Jalons de l'étude puis de la réalisation — portés par l'AFFAIRE : elle a plusieurs devis
    // (un par lot) mais une seule date de remise et un seul démarrage de travaux.
    dateLimiteRemise: '', dateRetourEffectif: '', dateDebutEtudes: '', dateFinEtudes: '',
    conducteur: '', dateDebutTravaux: '', dateFinTravaux: '',
  });
  const metaInit = useRef<string | null>(null);
  useEffect(() => {
    const a = detail.data?.affaire;
    if (!a || metaInit.current === affaireId) return;
    metaInit.current = affaireId;
    const l = a.lieu_execution ?? {};
    setMeta({
      responsable: a.responsable ?? '', budget: a.budget_objectif ?? '',
      adresse: l.adresse ?? '', cp: l.code_postal ?? '', ville: l.ville ?? '', notes: a.notes ?? '',
      dateLimiteRemise: a.date_limite_remise ?? '', dateRetourEffectif: a.date_retour_effectif ?? '',
      dateDebutEtudes: a.date_debut_etudes ?? '', dateFinEtudes: a.date_fin_etudes ?? '',
      conducteur: a.conducteur ?? '', dateDebutTravaux: a.date_debut_travaux ?? '',
      dateFinTravaux: a.date_fin_travaux ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data]);

  const saveMeta = useMutation({
    mutationFn: () => apiFetch(`/affaires/${affaireId}`, {
      method: 'PATCH',
      body: {
        responsable: meta.responsable || null,
        budgetObjectif: meta.budget || null,
        lieuExecution: { adresse: meta.adresse, code_postal: meta.cp, ville: meta.ville, pays: 'FR' },
        notes: meta.notes || null,
        dateLimiteRemise: meta.dateLimiteRemise,
        dateRetourEffectif: meta.dateRetourEffectif,
        dateDebutEtudes: meta.dateDebutEtudes,
        dateFinEtudes: meta.dateFinEtudes,
        conducteur: meta.conducteur || null,
        dateDebutTravaux: meta.dateDebutTravaux,
        dateFinTravaux: meta.dateFinTravaux,
      },
      token,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['affaire', affaireId] }),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  // --- nouveau devis ---
  const [nd, setNd] = useState({ designation: '', type: 'lot', numero: '' });
  const addDevis = useMutation({
    mutationFn: () => apiFetch(`/affaires/${affaireId}/devis`, {
      method: 'POST',
      body: { designation: nd.designation, type: nd.type, numero: nd.numero || null },
      token,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['affaire', affaireId] }); setNd({ designation: '', type: 'lot', numero: '' }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const a = detail.data?.affaire;
  const totals = detail.data?.totals;
  const marge = totals && Number(totals.pvHt) > 0 ? (Number(totals.margeNette) / Number(totals.pvHt)) * 100 : null;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/estimating" className="link">← Affaires</Link>
      </p>
      {detail.isError && <p className="muted">Affaire introuvable ou accès non autorisé.</p>}
      {err && <div className="error">{err}</div>}

      {a && (
        <>
          <h1 style={{ marginBottom: 4 }}>{a.code} — {a.name}</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            <span className={affaireBadge(a.status)}>{AFFAIRE_DERIVED_LABELS[a.status] ?? a.status}</span>
            {a.responsable ? ` · Resp. ${a.responsable}` : ''}
            {a.lieu_execution?.ville ? ` · ${a.lieu_execution.ville}` : ''}
            {a.moa ? ` · MOA : ${a.moa}` : ''}
          </p>

          <div className="card-grid" style={{ marginTop: 12 }}>
            <div className="card"><h2>Déboursé</h2><div className="stat">{euro(totals?.debourse)}</div></div>
            <div className="card"><h2>Prix de revient</h2><div className="stat">{euro(totals?.revient)}</div></div>
            <div className="card"><h2>Total HT</h2><div className="stat">{euro(totals?.pvHt)}</div></div>
            <div className="card">
              <h2>Marge nette</h2><div className="stat">{euro(totals?.margeNette)}</div>
              {marge != null && <p className="muted" style={{ margin: 0 }}>{marge.toFixed(1)} %</p>}
            </div>
            <div className="card"><h2>Budget objectif</h2><div className="stat">{a.budget_objectif ? euro(a.budget_objectif) : '—'}</div></div>
          </div>

          {/* Le prévu face au réel : ce qu'on a budgété, ce qu'on vend, ce que ça coûte vraiment.
              Le réel ne s'affiche que si un chantier existe — un coût à 0 se lirait « gratuit ». */}
          <Comparatif
            budget={a.budget_objectif}
            pvHt={totals?.pvHt}
            reel={detail.data?.reel ?? null}
            chantier={detail.data?.chantier ?? null}
          />

          {/* Deux blocs à parts égales : la grille de KPI les écraserait sur une colonne étroite. */}
          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <Jalons
              titre="Planning de l’étude"
              sousTitre={meta.responsable ? `Responsable : ${meta.responsable}` : 'Aucun responsable désigné'}
              dates={[
                { l: 'Date limite (client)', v: a.date_limite_remise, ton: 'limite' },
                { l: 'Retour effectif', v: a.date_retour_effectif, ton: 'ok' },
                { l: 'Début des études', v: a.date_debut_etudes, ton: 'neutre' },
                { l: 'Fin des études', v: a.date_fin_etudes, ton: 'neutre' },
              ]}
            />
            <Jalons
              titre="Réalisation de l’opération"
              sousTitre={meta.conducteur ? `Conducteur : ${meta.conducteur}` : 'Si l’affaire est gagnée'}
              dates={[
                { l: 'Début des travaux', v: a.date_debut_travaux, ton: 'ok' },
                { l: 'Fin des travaux', v: a.date_fin_travaux, ton: 'ok' },
              ]}
            />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Devis de l’affaire</h2>
            </div>
            {detail.data && detail.data.devis.length > 0 ? (
              <table className="grid" style={{ marginTop: 12 }}>
                <thead><tr>
                  <th>Désignation</th><th>Type</th><th>Statut</th>
                  <th style={{ textAlign: 'right' }}>Déboursé</th>
                  <th style={{ textAlign: 'right' }}>PV HT</th>
                  <th style={{ textAlign: 'right' }}>Marge nette</th>
                  <th />
                </tr></thead>
                <tbody>
                  {detail.data.devis.map((dv) => (
                    <tr
                      key={dv.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/estimating/${affaireId}/devis/${dv.id}`)}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    >
                      <td>
                        {dv.numero ? <span className="code-cell" style={{ marginRight: 6 }}>{dv.numero}</span> : null}
                        {dv.designation}
                      </td>
                      <td className="muted">{DEVIS_TYPE_LABELS[dv.type] ?? dv.type}</td>
                      <td><span className={devisBadge(dv.status)}>{AFFAIRE_STATUS_LABELS[dv.status] ?? dv.status}</span></td>
                      <td style={{ textAlign: 'right' }}>{euro(dv.kpis?.debourse)}</td>
                      <td style={{ textAlign: 'right' }}>{euro(dv.kpis?.pvHt)}</td>
                      <td style={{ textAlign: 'right' }}>{euro(dv.kpis?.margeNette)}</td>
                      <td style={{ textAlign: 'right', paddingRight: 8 }}>
                        <IconBtn
                          title="Ouvrir le devis"
                          color="var(--muted)"
                          onClick={(e) => { e.stopPropagation(); router.push(`/estimating/${affaireId}/devis/${dv.id}`); }}
                        >
                          <ArrowRight size={14} />
                        </IconBtn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">Aucun devis. Ajoutez-en un ci-dessous.</p>}

            <form
              style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}
              onSubmit={(e) => { e.preventDefault(); setErr(null); if (nd.designation) addDevis.mutate(); }}
            >
              <Field label="N° (optionnel)"><input style={{ width: 90 }} value={nd.numero} onChange={(e) => setNd({ ...nd, numero: e.target.value })} /></Field>
              <Field label="Désignation"><input placeholder="Lot 2 — Sols" value={nd.designation} onChange={(e) => setNd({ ...nd, designation: e.target.value })} /></Field>
              <Field label="Type">
                <select value={nd.type} onChange={(e) => setNd({ ...nd, type: e.target.value })}>
                  <option value="lot">Lot</option>
                  <option value="principal">Principal</option>
                  <option value="avenant">Avenant</option>
                </select>
              </Field>
              <button className="btn" type="submit" disabled={addDevis.isPending}>+ Nouveau devis</button>
            </form>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Informations de l’affaire</h2>
            <p className="muted" style={{ marginTop: 0 }}>Client et lieu d’exécution sont partagés par tous les devis de l’affaire.</p>
            <form
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
              onSubmit={(e) => { e.preventDefault(); setErr(null); saveMeta.mutate(); }}
            >
              <Field label="Responsable"><input value={meta.responsable} onChange={(e) => setMeta({ ...meta, responsable: e.target.value })} /></Field>
              <Field label="Budget objectif (€)"><input style={{ width: 110 }} value={meta.budget} onChange={(e) => setMeta({ ...meta, budget: e.target.value })} /></Field>
              <Field label="Adresse"><input value={meta.adresse} onChange={(e) => setMeta({ ...meta, adresse: e.target.value })} /></Field>
              <Field label="Code postal"><input style={{ width: 80 }} value={meta.cp} onChange={(e) => setMeta({ ...meta, cp: e.target.value })} /></Field>
              <Field label="Ville"><input value={meta.ville} onChange={(e) => setMeta({ ...meta, ville: e.target.value })} /></Field>
              <Field label="Notes"><input style={{ width: 220 }} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} /></Field>

              <div style={{ flexBasis: '100%', height: 0 }} />
              <span className="form-section-title" style={{ width: '100%', margin: '6px 0 0' }}>Jalons de l’étude</span>
              <Field label="Date limite (client)">
                <input type="date" value={meta.dateLimiteRemise} onChange={(e) => setMeta({ ...meta, dateLimiteRemise: e.target.value })} />
              </Field>
              <Field label="Retour effectif">
                <input type="date" value={meta.dateRetourEffectif} onChange={(e) => setMeta({ ...meta, dateRetourEffectif: e.target.value })} />
              </Field>
              <Field label="Début des études">
                <input type="date" value={meta.dateDebutEtudes} onChange={(e) => setMeta({ ...meta, dateDebutEtudes: e.target.value })} />
              </Field>
              <Field label="Fin des études">
                <input type="date" value={meta.dateFinEtudes} onChange={(e) => setMeta({ ...meta, dateFinEtudes: e.target.value })} />
              </Field>

              <div style={{ flexBasis: '100%', height: 0 }} />
              <span className="form-section-title" style={{ width: '100%', margin: '6px 0 0' }}>Réalisation</span>
              <Field label="Conducteur de travaux">
                <input value={meta.conducteur} onChange={(e) => setMeta({ ...meta, conducteur: e.target.value })} />
              </Field>
              <Field label="Début des travaux">
                <input type="date" value={meta.dateDebutTravaux} onChange={(e) => setMeta({ ...meta, dateDebutTravaux: e.target.value })} />
              </Field>
              <Field label="Fin des travaux">
                <input type="date" value={meta.dateFinTravaux} onChange={(e) => setMeta({ ...meta, dateFinTravaux: e.target.value })} />
              </Field>

              <button className="btn" type="submit" disabled={saveMeta.isPending}>Enregistrer</button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

/** Une date de jalon, ou un tiret quand elle n'est pas posée. */
function jour(v: string | null | undefined): string {
  if (!v) return '—';
  const [y, m, d] = v.split('-');
  return `${d}/${m}/${y}`;
}

const TONS: Record<string, { bg: string; border: string; color: string }> = {
  limite: { bg: '#fff7ed', border: '#fed7aa', color: '#c2410c' },
  ok: { bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
  neutre: { bg: '#f8fafc', border: '#e2e8f0', color: '#475569' },
};

/** Bloc de jalons : les dates d'une phase, lisibles d'un coup d'œil. */
function Jalons({ titre, sousTitre, dates }: {
  titre: string; sousTitre: string;
  dates: { l: string; v: string | null; ton: keyof typeof TONS }[];
}) {
  return (
    <div className="card" style={{ flex: '1 1 340px', margin: 0 }}>
      <h2 style={{ margin: 0 }}>{titre}</h2>
      <p className="muted" style={{ margin: '2px 0 10px', fontSize: 11 }}>{sousTitre}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {dates.map((d) => {
          const t = TONS[d.v ? d.ton : 'neutre'];
          return (
            <div key={d.l} style={{
              flex: '1 1 150px', padding: '8px 10px', borderRadius: 8,
              background: t.bg, border: `1px solid ${t.border}`,
            }}>
              <div style={{ fontSize: 10.5, color: t.color, fontWeight: 600 }}>{d.l}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: d.v ? '#1e293b' : '#94a3b8' }}>{jour(d.v)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Prévisionnel face au réel. Le budget objectif est ce qu'on s'est fixé, le CA devis ce qu'on
 * vend, le coût réel ce que le chantier a consommé. La barre montre où en est la vente par
 * rapport au budget.
 */
function Comparatif({ budget, pvHt, reel, chantier }: {
  budget: string | null;
  pvHt: string | number | undefined;
  reel: { coutReel: string; margeReelle: string } | null;
  chantier: { id: string; code: string; name: string } | null;
}) {
  const b = Number(budget) || 0;
  const ca = Number(pvHt) || 0;
  const pct = b > 0 ? (ca / b) * 100 : null;
  const ecart = b > 0 ? ca - b : null;
  const cases = [
    { l: 'Budget prévu', v: b > 0 ? euro(b) : '—', sub: null as string | null, ton: 'neutre' },
    {
      l: 'CA devis (HT)', v: euro(ca),
      sub: pct != null ? `${pct.toFixed(1)} % du budget` : null, ton: 'info',
    },
    {
      l: 'Coût réel', v: reel ? euro(reel.coutReel) : 'Non renseigné',
      sub: reel ? null : 'Aucun chantier lancé', ton: 'attention',
    },
    {
      l: 'Marge réelle', v: reel ? euro(reel.margeReelle) : '—',
      sub: reel && ca > 0 ? `${((Number(reel.margeReelle) / ca) * 100).toFixed(1)} %` : null, ton: 'ok',
    },
  ];
  const teintes: Record<string, string> = {
    neutre: '#f5f3ff', info: '#eff6ff', attention: '#fffbeb', ok: '#f0fdf4',
  };
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Comparatif prévisionnel / réel</h2>
        {chantier && (
          <Link href={`/chantiers/${chantier.id}`} className="btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }}>
            Chantier {chantier.code}
          </Link>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {cases.map((c) => (
          <div key={c.l} style={{
            flex: '1 1 180px', padding: '10px 12px', borderRadius: 10,
            background: teintes[c.ton], border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--muted)' }}>{c.l}</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{c.v}</div>
            {c.sub && <div className="muted" style={{ fontSize: 11 }}>{c.sub}</div>}
          </div>
        ))}
      </div>
      {b > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 8, borderRadius: 4, background: '#e2e8f0', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, (ca / b) * 100)}%`, height: '100%',
              background: ca > b ? '#f97316' : 'var(--primary)',
            }} />
          </div>
          <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 3 }}>
            <span>{ecart != null && `Écart : ${ecart >= 0 ? '+' : ''}${euro(ecart)}`}</span>
            <span>Budget : {euro(b)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field" style={{ marginBottom: 0 }}><label>{label}</label>{children}</div>;
}
