'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, ChevronDown, ChevronRight, Gauge } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';
import { Alerte, Bouton, CarteKpi } from '@/components/ui';

/* ─────────── types ─────────── */
const NATURE_LABELS: Record<string, string> = {
  material: 'Matériaux',
  equipment: 'Matériel',
  subcontract: 'Sous-traitance',
  labor: "Main d'œuvre",
  site_overhead: 'Frais de chantier',
};
const NATURE_ORDER = ['material', 'equipment', 'subcontract', 'labor', 'site_overhead'];

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
interface AdvancementRow {
  nature: string | null; pct: string; source: string; recorded_at: string; constat_date: string | null;
}
interface Advancement { global: AdvancementRow | null; byNature: AdvancementRow[] }
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
interface LineAdvancementRow {
  execution_line_id: string; pct: string; recorded_at: string; constat_date: string | null; source: string;
}
interface Budget { etude: string; objectif: string; previsionnel: string }
interface TreeNode {
  id: string; type: string; vendable: boolean; code: string | null; designation: string; unit: string | null;
  quantiteObjectif: string; engage: string; realise: string;
  budget: Budget | null; children: TreeNode[];
}
type Phase = 'etude' | 'contre_etude' | 'execution';
interface MarcheTree {
  id: string; code: string; name: string; execution_phase: Phase;
  totals: Budget; lines: TreeNode[];
}
interface ExecutionTree { chantier: { code: string }; marches: MarcheTree[] }

/** '18' (saisie %) → 0.18 (fraction). Renvoie null si vide/invalide. */
function pctToFraction(input: string): number | null {
  if (input.trim() === '') return null;
  const n = Number(input.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return n / 100;
}
function pctTexte(f: number | null): string {
  return f == null ? '—' : `${(f * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

/**
 * AVANCEMENT CONSTATÉ — écran à part entière, et non un onglet de la validation du budget.
 *
 * Constater n'est pas prévoir : on relève sur le chantier ce qui est RÉELLEMENT fait, à une date
 * donnée, ouvrage par ouvrage. Ce constat débloque le « droit à dépenser » — budget avancé =
 * budget objectif × avancement — qu'on compare à la dépense (engagé + réalisé) pour obtenir
 * l'écart au stade, puis l'EAC et la marge prévisionnelle.
 *
 * La saisie fine est celle des ouvrages ; le global et le par-nature restent disponibles comme
 * repli, pour un chantier qu'on ne suit pas à l'ouvrage.
 */
export default function AvancementPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const chantierId = String(useParams().chantierId);
  const [constatDate, setConstatDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);

  const chantier = useQuery({
    queryKey: ['chantier', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ code: string }>(`/chantiers/${chantierId}`, { token }),
  });
  const tree = useQuery({
    queryKey: ['execution-tree', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<ExecutionTree>(`/chantiers/${chantierId}/execution-tree`, { token }),
  });
  const lineAdv = useQuery({
    queryKey: ['line-advancement', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<LineAdvancementRow[]>(`/chantiers/${chantierId}/line-advancement`, { token }),
  });
  const results = useQuery({
    queryKey: ['chantier-results', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Results>(`/chantiers/${chantierId}/results`, { token }),
  });
  const advancement = useQuery({
    queryKey: ['advancement', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<Advancement>(`/chantiers/${chantierId}/advancement`, { token }),
  });
  const forecast = useQuery({
    queryKey: ['chantier-forecast', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<Forecast>(`/chantiers/${chantierId}/forecast`, { token }),
  });

  /** Un constat recalcule tout l'aval : indicateurs, courbes, tableau de bord Direction. */
  const rafraichir = () => {
    for (const key of [
      ['advancement', chantierId], ['line-advancement', chantierId], ['chantier-forecast', chantierId],
      ['chantier-analytical', chantierId], ['chantier-results', chantierId], ['execution-tree', chantierId],
      ['pilotage', chantierId], ['portfolio'],
    ]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };
  const onErr = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Erreur');

  const mLine = useMutation({
    mutationFn: ({ id, pct }: { id: string; pct: string }) =>
      apiFetch(`/chantiers/${chantierId}/line-advancement`, {
        method: 'POST', token, body: { executionLineId: id, pct, constatDate },
      }),
    onSuccess: () => { setErr(null); rafraichir(); }, onError: onErr,
  });
  const mApply = useMutation({
    mutationFn: ({ pct, marcheId }: { pct: string; marcheId: string }) =>
      apiFetch(`/chantiers/${chantierId}/line-advancement/apply`, {
        method: 'POST', token, body: { pct, marcheId, constatDate },
      }),
    onSuccess: () => { setErr(null); rafraichir(); }, onError: onErr,
  });
  const mFromSituations = useMutation({
    mutationFn: () =>
      apiFetch(`/chantiers/${chantierId}/line-advancement/from-situations`, { method: 'POST', token }),
    onSuccess: () => { setErr(null); rafraichir(); }, onError: onErr,
  });
  const mGlobal = useMutation({
    mutationFn: (body: { nature?: string | null; pct: number }) =>
      apiFetch(`/chantiers/${chantierId}/advancement`, {
        method: 'POST', token, body: { ...body, constatDate },
      }),
    onSuccess: () => { setErr(null); rafraichir(); }, onError: onErr,
  });

  const pctByLine = new Map((lineAdv.data ?? []).map((r) => [r.execution_line_id, Number(r.pct)]));
  const dernierConstat = (lineAdv.data ?? [])
    .map((r) => r.constat_date)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1) ?? advancement.data?.global?.constat_date ?? null;

  const globalPctNow = advancement.data?.global ? Number(advancement.data.global.pct) : null;
  const byNatureMap = new Map((advancement.data?.byNature ?? []).map((r) => [r.nature as string, Number(r.pct)]));
  const natures = (results.data?.byNature ?? [])
    .filter((n) => Number(n.budgetObjectif) !== 0 || byNatureMap.has(n.nature))
    .sort((a, b) => NATURE_ORDER.indexOf(a.nature) - NATURE_ORDER.indexOf(b.nature));
  const budgetTotal = results.data ? Number(results.data.totals.budgetObjectif) : 0;
  const f = forecast.data?.indicators;

  if (results.isError || advancement.isError) {
    return (
      <div>
        <p className="muted" style={{ marginTop: 0 }}>
          <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {chantier.data?.code ?? ''}</Link>
        </p>
        <h1>Avancement constaté</h1>
        <p className="muted">Module « Gestion financière » non actif pour cet utilisateur, ou accès refusé.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {chantier.data?.code ?? ''}</Link>
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 320 }}>
          <h1 style={{ marginBottom: 4 }}>Avancement constaté</h1>
          <p className="muted" style={{ marginTop: 0, maxWidth: 780 }}>
            Ce qui est <strong>réellement réalisé</strong> sur le chantier, à une date de constat, ouvrage par
            ouvrage. Le constat débloque le <strong>montant constaté</strong> (droit à dépenser) = budget objectif ×
            avancement, comparé à la dépense pour donner l'écart au stade, l'EAC et la marge prévisionnelle.
            L'enveloppe elle-même se pilote dans <Link href={`/chantiers/${chantierId}/budgets`} className="link">Budgets</Link>.
          </p>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>
            <CalendarCheck size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Date du constat
          </label>
          <input type="date" value={constatDate} onChange={(e) => setConstatDate(e.target.value)} />
          <span className="muted" style={{ fontSize: 11 }}>
            {dernierConstat ? `Dernier constat au ${new Date(dernierConstat).toLocaleDateString('fr-FR')}` : 'Aucun constat enregistré'}
          </span>
        </div>
      </div>

      {err && <Alerte>{err}</Alerte>}

      {f && (
        <div className="card-grid" style={{ marginTop: 12 }}>
          <CarteKpi titre="Montant constaté (droit à dépenser)" valeur={euro(f.budgetAvance)} icone={Gauge}
            detail={`Avancement global ${pctTexte(Number(forecast.data?.avancement ?? 0))}`} />
          <CarteKpi titre="Écart au stade" valeur={euro(f.ecartAuStade)}
            ton={Number(f.ecartAuStade) < 0 ? 'danger' : 'succes'}
            detail="Constaté − (engagé + réalisé)" />
          <CarteKpi titre="Coût final estimé (EAC)" valeur={euro(f.eac)} />
          <CarteKpi titre="Marge prévisionnelle" valeur={euro(f.margePrevisionnelle)}
            ton={Number(f.margePrevisionnelle ?? 0) < 0 ? 'danger' : undefined} />
        </div>
      )}

      {tree.data?.marches.length === 0 && (
        <p className="muted">Ce chantier n'a pas encore de marché : rien à constater.</p>
      )}

      {tree.data?.marches.map((m) => (
        <MarcheAvancement
          key={m.id}
          marche={m}
          pctByLine={pctByLine}
          pending={mLine.isPending || mApply.isPending || mFromSituations.isPending}
          onLine={(id, pct) => mLine.mutate({ id, pct })}
          onApply={(pct) => mApply.mutate({ pct, marcheId: m.id })}
          onFromSituations={() => mFromSituations.mutate()}
        />
      ))}

      {/* Repli : un chantier qu'on ne suit pas à l'ouvrage se constate globalement ou par nature. */}
      <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          Constat global ou par nature (sans détail par ouvrage)
        </summary>
        <p className="muted" style={{ marginTop: 8 }}>
          Utile quand les ouvrages ne sont pas suivis un par un. Le moteur prend le % d'une nature s'il existe,
          sinon le global — et la moyenne pondérée des ouvrages dès qu'ils sont renseignés.
        </p>
        <GlobalAdvancement
          currentPct={globalPctNow}
          budgetTotal={budgetTotal}
          saving={mGlobal.isPending}
          onSave={(pct) => mGlobal.mutate({ nature: null, pct })}
        />
        <table className="grid" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Nature</th>
              <th style={{ textAlign: 'right' }}>Budget objectif</th>
              <th style={{ textAlign: 'right' }}>Réalisé + engagé</th>
              <th style={{ textAlign: 'right' }}>Avanc. actuel</th>
              <th style={{ textAlign: 'right' }}>Nouvel avancement</th>
              <th style={{ textAlign: 'right' }}>Montant constaté</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {natures.map((n) => (
              <NatureRow
                key={n.nature}
                nature={n}
                currentPct={byNatureMap.get(n.nature) ?? null}
                globalPct={globalPctNow}
                saving={mGlobal.isPending}
                onSave={(pct) => mGlobal.mutate({ nature: n.nature, pct })}
              />
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/* ─────────── constat d'un marché, ouvrage par ouvrage ─────────── */
function MarcheAvancement({
  marche, pctByLine, pending, onLine, onApply, onFromSituations,
}: {
  marche: MarcheTree;
  pctByLine: Map<string, number>;
  pending: boolean;
  onLine: (lineId: string, pctFraction: string) => void;
  onApply: (pctFraction: string) => void;
  onFromSituations: () => void;
}) {
  const [global, setGlobal] = useState('');
  const enExecution = marche.execution_phase === 'execution';
  const validGlobal = global.trim() !== '' && Number(global) >= 0 && Number(global) <= 100;

  const totaux = useMemo(() => {
    const constate = marche.lines.reduce(
      (a, l) => a + (l.budget ? Number(l.budget.objectif) * (pctByLine.get(l.id) ?? 0) : 0), 0,
    );
    const engage = marche.lines.reduce((a, l) => a + Number(l.engage), 0);
    const realise = marche.lines.reduce((a, l) => a + Number(l.realise), 0);
    return { constate, engage, realise, ecart: constate - (engage + realise) };
  }, [marche.lines, pctByLine]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Marché {marche.code}</h2>
        <span className="muted">{marche.name}</span>
        {!enExecution && (
          <span className="badge warning">
            {marche.execution_phase === 'etude' ? 'Budget d’étude à valider' : 'Contre-étude en cours'}
          </span>
        )}
      </div>

      {!enExecution ? (
        <p className="muted" style={{ fontSize: 12 }}>
          Le constat s'ouvre quand le marché passe en exécution : validez l'étude puis la contre-étude dans
          « Étude d'exécution ». Constater sur un budget non arrêté comparerait le réel à une cible mouvante.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Avancement à appliquer à tous les ouvrages (%)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" min={0} max={100} step={1} value={global} placeholder="ex. 50"
                onChange={(e) => setGlobal(e.target.value)} style={{ width: 100, textAlign: 'right' }} />
              <Bouton variante="secondaire" disabled={!validGlobal || pending}
                onClick={() => { onApply(String(Number(global) / 100)); setGlobal(''); }}>
                Appliquer
              </Bouton>
            </div>
          </div>
          <div>
            <Bouton variante="secondaire" disabled={pending} onClick={onFromSituations}>
              Reprendre l'avancement des situations
            </Bouton>
            <div className="muted" style={{ fontSize: 11, marginTop: 2, maxWidth: 280 }}>
              Proposition depuis la dernière situation — corrigeable ensuite ouvrage par ouvrage.
            </div>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table className="grid" style={{ margin: 0, minWidth: 820 }}>
          <thead>
            <tr>
              <th>Ouvrage</th>
              <th style={{ textAlign: 'right' }}>Qté</th>
              <th style={{ textAlign: 'right' }}>Budget objectif</th>
              <th style={{ textAlign: 'right' }}>Avanc. (%)</th>
              <th style={{ textAlign: 'right' }}>Montant constaté</th>
              <th style={{ textAlign: 'right' }}>Engagé</th>
              <th style={{ textAlign: 'right' }}>Réalisé</th>
              <th style={{ textAlign: 'right' }}>Écart au stade</th>
            </tr>
          </thead>
          <tbody>
            {marche.lines.map((n) => (
              <LigneConstat key={n.id} node={n} depth={0} pctByLine={pctByLine}
                editable={enExecution} pending={pending} onLine={onLine} />
            ))}
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td><strong>Total marché</strong></td>
              <td></td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(marche.totals.objectif)}</td>
              <td></td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(totaux.constate)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(totaux.engage)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(totaux.realise)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: totaux.ecart < 0 ? 'var(--danger)' : undefined }}>
                {euro(totaux.ecart)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LigneConstat({
  node, depth, pctByLine, editable, pending, onLine,
}: {
  node: TreeNode;
  depth: number;
  pctByLine: Map<string, number>;
  editable: boolean;
  pending: boolean;
  onLine: (lineId: string, pctFraction: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const pct = pctByLine.get(node.id) ?? 0;
  const constate = node.budget ? Number(node.budget.objectif) * pct : 0;
  const depense = Number(node.engage) + Number(node.realise);
  const ecart = constate - depense;
  const pad = 8 + depth * 20;

  return (
    <>
      <tr style={{ background: depth === 0 ? 'var(--bg)' : undefined }}>
        <td style={{ paddingLeft: pad }}>
          {node.children.length > 0 ? (
            <button onClick={() => setOpen((v) => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginRight: 4, verticalAlign: 'middle', color: 'var(--muted)' }}>
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : <span style={{ display: 'inline-block', width: 17 }} />}
          {node.code && <strong>{node.code} </strong>}{node.designation}
        </td>
        <td style={{ textAlign: 'right' }}>
          {Number(node.quantiteObjectif).toLocaleString('fr-FR')} {node.unit ?? ''}
        </td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {node.budget ? euro(node.budget.objectif) : ''}
        </td>
        <td style={{ textAlign: 'right' }}>
          {node.budget && editable ? (
            <SaisiePct value={pct} disabled={pending} onSubmit={(fraction) => onLine(node.id, fraction)} />
          ) : node.budget ? pctTexte(pct) : ''}
        </td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{node.budget ? euro(constate) : ''}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{node.budget ? euro(node.engage) : ''}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{node.budget ? euro(node.realise) : ''}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: node.budget && ecart < 0 ? 'var(--danger)' : undefined }}>
          {node.budget ? euro(ecart) : ''}
        </td>
      </tr>
      {open && node.children.map((child) => (
        <LigneConstat key={child.id} node={child} depth={depth + 1} pctByLine={pctByLine}
          editable={editable} pending={pending} onLine={onLine} />
      ))}
    </>
  );
}

/** Saisie d'un % d'avancement : validée à la sortie du champ ou par Entrée. */
function SaisiePct({ value, disabled, onSubmit }: { value: number; disabled: boolean; onSubmit: (fraction: string) => void }) {
  const affiche = String(Math.round(value * 1000) / 10);
  const [v, setV] = useState(affiche);
  useEffect(() => { setV(affiche); }, [affiche]);
  const dirty = v !== affiche;
  const commit = () => {
    if (!dirty || v.trim() === '') return;
    const f = Number(v.replace(',', '.')) / 100;
    if (f >= 0 && f <= 1) onSubmit(String(f));
  };
  return (
    <input
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{ width: 72, textAlign: 'right', padding: '2px 6px', borderColor: dirty ? 'var(--accent)' : undefined }}
    />
  );
}

/* ─────────── constat global ─────────── */
function GlobalAdvancement({
  currentPct, budgetTotal, saving, onSave,
}: {
  currentPct: number | null;
  budgetTotal: number;
  saving: boolean;
  onSave: (pct: number) => void;
}) {
  const [input, setInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const draft = pctToFraction(input);
  const previewFraction = draft ?? currentPct ?? 0;
  const previewCredit = budgetTotal * previewFraction;

  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Avancement global actuel</label>
        <div className="stat" style={{ fontSize: 22 }}>{pctTexte(currentPct)}</div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Nouvel avancement (%)</label>
        <input type="number" min={0} max={100} step={1} value={input}
          placeholder={currentPct != null ? String(Math.round(currentPct * 100)) : '0'}
          onChange={(e) => setInput(e.target.value)} style={{ width: 120, textAlign: 'right' }} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Montant constaté (aperçu)</label>
        <div className="stat" style={{ fontSize: 22 }}>{euro(previewCredit)}</div>
        <span className="muted" style={{ fontSize: 11 }}>
          = {euro(budgetTotal)} × {pctTexte(previewFraction)}
        </span>
      </div>
      <Bouton
        disabled={saving || draft == null}
        onClick={() => {
          setErr(null);
          if (draft == null) return;
          if (draft < 0 || draft > 1) { setErr("L'avancement doit être entre 0 et 100 %."); return; }
          onSave(draft);
          setInput('');
        }}
      >
        {saving ? 'Enregistrement…' : "Enregistrer l'avancement global"}
      </Bouton>
      {err && <Alerte>{err}</Alerte>}
    </div>
  );
}

/* ─────────── constat d'une nature ─────────── */
function NatureRow({
  nature, currentPct, globalPct, saving, onSave,
}: {
  nature: NatureResult;
  currentPct: number | null;
  globalPct: number | null;
  saving: boolean;
  onSave: (pct: number) => void;
}) {
  const [input, setInput] = useState('');
  const draft = pctToFraction(input);
  const budget = Number(nature.budgetObjectif);
  const depense = Number(nature.engage) + Number(nature.realise);
  const effectiveFraction = useMemo(() => draft ?? currentPct ?? globalPct ?? 0, [draft, currentPct, globalPct]);
  const credit = budget * effectiveFraction;
  const label = NATURE_LABELS[nature.nature] ?? nature.nature;

  return (
    <tr>
      <td>{label}</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(nature.budgetObjectif)}</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(depense)}</td>
      <td style={{ textAlign: 'right' }}>
        {currentPct == null ? (
          <span className="muted" style={{ fontSize: 12 }}>
            {globalPct != null ? `${pctTexte(globalPct)} (global)` : '—'}
          </span>
        ) : pctTexte(currentPct)}
      </td>
      <td style={{ textAlign: 'right' }}>
        <input type="number" min={0} max={100} step={1} value={input}
          placeholder={currentPct == null ? '—' : String(Math.round(currentPct * 100))}
          onChange={(e) => setInput(e.target.value)} style={{ width: 90, textAlign: 'right' }} />
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(credit)}</td>
      <td style={{ textAlign: 'right' }}>
        <Bouton variante="secondaire" disabled={saving || draft == null || draft < 0 || draft > 1}
          onClick={() => { if (draft != null) { onSave(draft); setInput(''); } }}>
          Enregistrer
        </Bouton>
      </td>
    </tr>
  );
}
