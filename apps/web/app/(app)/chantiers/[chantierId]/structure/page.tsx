'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient, UseMutationResult } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, CheckCircle2, Clock, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { PanneauVentilation } from '@/components/PanneauVentilation';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';

/* ─────────── types ─────────── */
interface Nomenclature {
  id: string; code: string; label: string; nature: string; unit: string | null;
  unitCostEtude: string; unitCostObjectif: string;
}
interface CompNode {
  id: string; kind: string; childLineId: string | null; rate: string | null;
  quantiteEtude: string; quantiteObjectif: string; nomenclature: Nomenclature | null;
}
interface Budget { etude: string; objectif: string; previsionnel: string }
interface TreeNode {
  id: string; type: string; vendable: boolean; code: string | null; designation: string; unit: string | null;
  quantiteEtude: string; quantiteObjectif: string;
  debourseUnitaireEtude: string; debourseUnitaireObjectif: string;
  engage: string; realise: string;
  budget: Budget | null; components: CompNode[]; children: TreeNode[];
}
type Phase = 'etude' | 'contre_etude' | 'execution';
interface MarcheTree {
  id: string; code: string; name: string; total_ht: string;
  execution_phase: Phase; etude_validated_at: string | null; contre_etude_validated_at: string | null;
  totals: Budget; lines: TreeNode[];
}
interface ExecutionTree { chantier: { code: string }; marches: MarcheTree[] }

const NATURE_LABELS: Record<string, string> = {
  material: 'Matériaux', equipment: 'Matériel', subcontract: 'Sous-traitance',
  labor: "Main d'œuvre", site_overhead: 'Frais de chantier',
};
const NATURE_OPTIONS = ['material', 'labor', 'equipment', 'subcontract'];
const PHASE_META: Record<Phase, { label: string; badge: string }> = {
  etude: { label: "Budget d'étude", badge: 'info' },
  contre_etude: { label: 'Contre-étude', badge: 'warning' },
  execution: { label: 'Exécution', badge: 'success' },
};

function dt(s: string | null): string {
  if (!s) return '';
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Mutations d'édition partagées par l'arbre (contre-étude). */
interface Edit {
  editable: boolean;
  renegotiate: (nomencId: string, unitCostObjectif: string) => void;
  setComponentQty: (componentId: string, quantiteObjectif: string) => void;
  setLineQty: (lineId: string, quantiteObjectif: string) => void;
  removeComponent: (componentId: string) => void;
  removeLine: (lineId: string) => void;
  addResource: (lineId: string, body: Record<string, string>) => void;
  pending: boolean;
}

/** Saisie de l'avancement par ouvrage (phase exécution). */
interface Advance {
  active: boolean;
  pctByLine: Map<string, number>;
  setLinePct: (lineId: string, pctFraction: string) => void;
  pending: boolean;
}
interface LineAdvancementRow { execution_line_id: string; pct: string }

export default function StructurePage() {
  const { token } = useAuth();
  const chantierId = String(useParams().chantierId);

  const tree = useQuery({
    queryKey: ['execution-tree', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<ExecutionTree>(`/chantiers/${chantierId}/execution-tree`, { token }),
  });

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {tree.data?.chantier.code ?? ''}</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>Structure & budget d'exécution</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        La même structure que le déboursé du devis, marché par marché. Le suivi passe par trois phases :
        <strong> budget d'étude</strong> (à valider) → <strong>contre-étude</strong> (renégocier ratios, quantités,
        PU, prestations) → <strong>exécution</strong>. Chaque validation est horodatée.
      </p>

      {tree.isError && (
        <p className="muted">
          {tree.error instanceof ApiError && tree.error.status === 403
            ? 'Suivi de chantiers non autorisé pour cet utilisateur.'
            : 'Chantier introuvable.'}
        </p>
      )}
      {tree.data && tree.data.marches.length === 0 && (
        <p className="muted">Ce chantier n'a pas encore de marché : passez par « Acceptation de commande » pour y rattacher un devis gagné.</p>
      )}

      {tree.data?.marches.map((m) => (
        <MarcheBlock key={m.id} marche={m} chantierId={chantierId} token={token} />
      ))}

      {/* Ranger une dépense se fait ici, dans la structure — pas dans le tableau de résultats,
          qui donne à lire et non à corriger. */}
      <PanneauVentilation chantierId={chantierId} />
    </div>
  );
}

/* ─────────── un marché ─────────── */
function MarcheBlock({ marche, chantierId, token }: { marche: MarcheTree; chantierId: string; token: string | null }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [adding, setAdding] = useState(false);
  const phaseMeta = PHASE_META[marche.execution_phase];
  const editable = marche.execution_phase === 'contre_etude';
  const advancing = marche.execution_phase === 'execution';

  const lineAdv = useQuery({
    queryKey: ['line-advancement', chantierId],
    enabled: Boolean(token) && advancing,
    retry: false,
    queryFn: () => apiFetch<LineAdvancementRow[]>(`/chantiers/${chantierId}/line-advancement`, { token }),
  });
  const pctByLine = new Map((lineAdv.data ?? []).map((r) => [r.execution_line_id, Number(r.pct)]));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['execution-tree', chantierId] });
    qc.invalidateQueries({ queryKey: ['change-log', marche.id] });
    qc.invalidateQueries({ queryKey: ['chantier-marches', chantierId] });
    // l'avancement alimente le prédictif : rafraîchir tout ce qui en dépend
    qc.invalidateQueries({ queryKey: ['line-advancement', chantierId] });
    qc.invalidateQueries({ queryKey: ['chantier-forecast', chantierId] });
    qc.invalidateQueries({ queryKey: ['chantier-results', chantierId] });
    qc.invalidateQueries({ queryKey: ['pilotage', chantierId] });
    qc.invalidateQueries({ queryKey: ['portfolio'] });
  };
  const onErr = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Erreur');

  const validate = useMutation({
    mutationFn: (step: 'etude' | 'contre-etude') =>
      apiFetch(`/marches/${marche.id}/${step}/validate`, { method: 'POST', token }),
    onSuccess: () => { setErr(null); invalidate(); }, onError: onErr,
  });
  const mRenegotiate = useMutation({
    mutationFn: ({ nomencId, v }: { nomencId: string; v: string }) =>
      apiFetch(`/chantiers/${chantierId}/nomenclature/${nomencId}`, { method: 'PUT', token, body: { unitCostObjectif: v } }),
    onSuccess: () => { setErr(null); invalidate(); }, onError: onErr,
  });
  const mCompQty = useMutation({
    mutationFn: ({ id, v }: { id: string; v: string }) =>
      apiFetch(`/execution-components/${id}/quantity`, { method: 'PUT', token, body: { quantiteObjectif: v } }),
    onSuccess: () => { setErr(null); invalidate(); }, onError: onErr,
  });
  const mLineQty = useMutation({
    mutationFn: ({ id, v }: { id: string; v: string }) =>
      apiFetch(`/execution-lines/${id}/quantity`, { method: 'PUT', token, body: { quantiteObjectif: v } }),
    onSuccess: () => { setErr(null); invalidate(); }, onError: onErr,
  });
  const mRemoveComp = useMutation({
    mutationFn: (id: string) => apiFetch(`/execution-components/${id}`, { method: 'DELETE', token }),
    onSuccess: () => { setErr(null); invalidate(); }, onError: onErr,
  });
  const mRemoveLine = useMutation({
    mutationFn: (id: string) => apiFetch(`/execution-lines/${id}`, { method: 'DELETE', token }),
    onSuccess: () => { setErr(null); invalidate(); }, onError: onErr,
  });
  const mAddResource = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) =>
      apiFetch(`/execution-lines/${id}/components`, { method: 'POST', token, body }),
    onSuccess: () => { setErr(null); invalidate(); }, onError: onErr,
  });
  const mAddOuvrage: UseMutationResult<unknown, unknown, Record<string, string>> = useMutation({
    mutationFn: (body: Record<string, string>) =>
      apiFetch(`/marches/${marche.id}/execution-lines`, { method: 'POST', token, body }),
    onSuccess: () => { setErr(null); invalidate(); setAdding(false); }, onError: onErr,
  });

  const mLineAdv = useMutation({
    mutationFn: ({ id, pct }: { id: string; pct: string }) =>
      apiFetch(`/chantiers/${chantierId}/line-advancement`, { method: 'POST', token, body: { executionLineId: id, pct } }),
    onSuccess: () => { setErr(null); invalidate(); }, onError: onErr,
  });
  const mApplyAdv: UseMutationResult<unknown, unknown, string> = useMutation({
    mutationFn: (pct: string) =>
      apiFetch(`/chantiers/${chantierId}/line-advancement/apply`, { method: 'POST', token, body: { pct, marcheId: marche.id } }),
    onSuccess: () => { setErr(null); invalidate(); }, onError: onErr,
  });
  const mFromSituations = useMutation({
    mutationFn: () => apiFetch(`/chantiers/${chantierId}/line-advancement/from-situations`, { method: 'POST', token }),
    onSuccess: () => { setErr(null); invalidate(); }, onError: onErr,
  });

  const pending = [mRenegotiate, mCompQty, mLineQty, mRemoveComp, mRemoveLine, mAddResource].some((m) => m.isPending);
  const edit: Edit = {
    editable,
    renegotiate: (nomencId, v) => mRenegotiate.mutate({ nomencId, v }),
    setComponentQty: (id, v) => mCompQty.mutate({ id, v }),
    setLineQty: (id, v) => mLineQty.mutate({ id, v }),
    removeComponent: (id) => mRemoveComp.mutate(id),
    removeLine: (id) => mRemoveLine.mutate(id),
    addResource: (id, body) => mAddResource.mutate({ id, body }),
    pending,
  };
  const advance: Advance = {
    active: advancing,
    pctByLine,
    setLinePct: (id, pct) => mLineAdv.mutate({ id, pct }),
    pending: mLineAdv.isPending || mApplyAdv.isPending,
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Marché {marche.code}</h2>
        <span className={`badge ${phaseMeta.badge}`}>{phaseMeta.label}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {marche.execution_phase === 'etude' && (
            <button className="btn" disabled={validate.isPending} onClick={() => { setErr(null); validate.mutate('etude'); }}>
              {validate.isPending ? '…' : 'Valider le budget d’étude'}
            </button>
          )}
          {editable && (
            <button className="btn" disabled={validate.isPending} onClick={() => { setErr(null); validate.mutate('contre-etude'); }}>
              {validate.isPending ? '…' : 'Valider la contre-étude'}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 8, fontSize: 12 }} className="muted">
        {marche.etude_validated_at && (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <CheckCircle2 size={13} /> Étude validée le {dt(marche.etude_validated_at)}
          </span>
        )}
        {marche.contre_etude_validated_at && (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <CheckCircle2 size={13} /> Contre-étude validée le {dt(marche.contre_etude_validated_at)}
          </span>
        )}
        <button className="link" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => setShowLog((v) => !v)}>
          <Clock size={13} /> {showLog ? 'Masquer' : 'Voir'} l'historique
        </button>
      </div>
      {editable && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
          Contre-étude en cours : modifiez les PU et quantités (Entrée pour valider), ajoutez ou supprimez des
          ressources et des ouvrages. Le budget objectif est recalculé à chaque changement.
        </p>
      )}
      {advancing && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
          Exécution : saisissez l'avancement <strong>ouvrage par ouvrage</strong> (%). Le budget avancé (crédit) =
          budget objectif × avancement, agrégé pour alimenter l'écart au stade, l'EAC et la marge prévisionnelle.
        </p>
      )}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
      {showLog && <ChangeLog marcheId={marche.id} token={token} />}

      {advancing && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
          <GlobalAdvanceControl onApply={(pct) => mApplyAdv.mutate(pct)} pending={mApplyAdv.isPending} />
          <div>
            <button className="btn btn-secondary" style={{ fontSize: 13 }} disabled={mFromSituations.isPending}
              onClick={() => { setErr(null); mFromSituations.mutate(); }}>
              {mFromSituations.isPending ? '…' : "Reprendre l'avancement des situations"}
            </button>
            <div className="muted" style={{ fontSize: 11, marginTop: 2, maxWidth: 260 }}>
              Proposition depuis la dernière situation — modifiable ensuite ouvrage par ouvrage.
            </div>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table className="grid" style={{ margin: 0, minWidth: 760 }}>
          <thead>
            <tr>
              <th>Poste</th>
              <th style={{ textAlign: 'right' }}>Qté</th>
              <th style={{ textAlign: 'right' }}>Budget étude</th>
              <th style={{ textAlign: 'right' }}>Objectif</th>
              <th style={{ textAlign: 'right' }}>Prévisionnel</th>
              {advancing && <th style={{ textAlign: 'right' }}>Avanc. (%)</th>}
              {advancing && <th style={{ textAlign: 'right' }}>Budget avancé</th>}
              {advancing && <th style={{ textAlign: 'right' }}>Engagé</th>}
              {advancing && <th style={{ textAlign: 'right' }}>Réalisé</th>}
              {advancing && <th style={{ textAlign: 'right' }}>Écart au stade</th>}
              {editable && <th style={{ width: 40 }}></th>}
            </tr>
          </thead>
          <tbody>
            {marche.lines.map((n) => <LineRows key={n.id} node={n} depth={0} edit={edit} advance={advance} />)}
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td><strong>Total marché</strong></td>
              <td></td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(marche.totals.etude)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(marche.totals.objectif)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(marche.totals.previsionnel)}</td>
              {advancing && (() => {
                const tBudgetAvance = marche.lines.reduce((a, l) => a + (l.budget ? Number(l.budget.objectif) * (pctByLine.get(l.id) ?? 0) : 0), 0);
                const tEngage = marche.lines.reduce((a, l) => a + Number(l.engage), 0);
                const tRealise = marche.lines.reduce((a, l) => a + Number(l.realise), 0);
                const tEcart = tBudgetAvance - (tEngage + tRealise);
                return (
                  <>
                    <td></td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(tBudgetAvance)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(tEngage)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(tRealise)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: tEcart < 0 ? 'var(--danger)' : undefined }}>{euro(tEcart)}</td>
                  </>
                );
              })()}
              {editable && <td></td>}
            </tr>
          </tbody>
        </table>
      </div>

      {editable && (
        <div style={{ marginTop: 10 }}>
          {adding ? (
            <AddOuvrageForm onSubmit={(body) => mAddOuvrage.mutate(body)} onCancel={() => setAdding(false)} pending={mAddOuvrage.isPending} />
          ) : (
            <button className="btn btn-secondary" style={{ fontSize: 13 }} onClick={() => setAdding(true)}>
              <Plus size={13} style={{ verticalAlign: 'middle' }} /> Ajouter un ouvrage
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────── ligne d'ouvrage + composants (récursif) ─────────── */
function LineRows({ node, depth, edit, advance }: { node: TreeNode; depth: number; edit: Edit; advance: Advance }) {
  const [open, setOpen] = useState(depth === 0);
  const [addingRes, setAddingRes] = useState(false);
  const hasDetail = node.components.length > 0 || node.children.length > 0;
  const pad = 8 + depth * 20;
  const cols = 5 + (edit.editable ? 1 : 0) + (advance.active ? 5 : 0);
  const linePct = advance.pctByLine.get(node.id) ?? 0;
  const budgetAvance = node.budget ? Number(node.budget.objectif) * linePct : 0;
  const depense = Number(node.engage) + Number(node.realise);
  const ecartAuStade = budgetAvance - depense;

  return (
    <>
      <tr style={{ background: depth === 0 ? 'var(--bg)' : undefined }}>
        <td style={{ paddingLeft: pad }}>
          {hasDetail ? (
            <button onClick={() => setOpen((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginRight: 4, verticalAlign: 'middle', color: 'var(--muted)' }}>
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : <span style={{ display: 'inline-block', width: 17 }} />}
          {node.code && <strong>{node.code} </strong>}{node.designation}
        </td>
        <td style={{ textAlign: 'right' }}>
          {edit.editable ? (
            <EditableNumber value={node.quantiteObjectif} suffix={node.unit ?? ''} onSubmit={(v) => edit.setLineQty(node.id, v)} disabled={edit.pending} />
          ) : (
            <>{Number(node.quantiteObjectif).toLocaleString('fr-FR')} {node.unit ?? ''}</>
          )}
        </td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{node.budget ? euro(node.budget.etude) : ''}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{node.budget ? euro(node.budget.objectif) : ''}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{node.budget ? euro(node.budget.previsionnel) : ''}</td>
        {advance.active && (
          <td style={{ textAlign: 'right' }}>
            {node.budget ? (
              <EditableNumber
                value={String(Math.round(linePct * 1000) / 10)}
                onSubmit={(v) => { const f = Number(v) / 100; if (f >= 0 && f <= 1) advance.setLinePct(node.id, String(f)); }}
                disabled={advance.pending}
              />
            ) : ''}
          </td>
        )}
        {advance.active && (
          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{node.budget ? euro(budgetAvance) : ''}</td>
        )}
        {advance.active && (
          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{node.budget ? euro(node.engage) : ''}</td>
        )}
        {advance.active && (
          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{node.budget ? euro(node.realise) : ''}</td>
        )}
        {advance.active && (
          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: node.budget && ecartAuStade < 0 ? 'var(--danger)' : undefined }}>
            {node.budget ? euro(ecartAuStade) : ''}
          </td>
        )}
        {edit.editable && (
          <td style={{ textAlign: 'center' }}>
            <IconButton title="Supprimer l'ouvrage" onClick={() => edit.removeLine(node.id)} disabled={edit.pending}><Trash2 size={13} /></IconButton>
          </td>
        )}
      </tr>
      {open && node.components.map((c) => <ComponentRow key={c.id} comp={c} pad={pad + 20} edit={edit} advance={advance} />)}
      {open && node.children.map((child) => <LineRows key={child.id} node={child} depth={depth + 1} edit={edit} advance={advance} />)}
      {open && edit.editable && (
        <tr>
          <td colSpan={cols} style={{ paddingLeft: pad + 20 }}>
            {addingRes ? (
              <AddResourceForm onSubmit={(body) => { edit.addResource(node.id, body); setAddingRes(false); }} onCancel={() => setAddingRes(false)} />
            ) : (
              <button className="link" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={() => setAddingRes(true)}>
                <Plus size={12} /> Ajouter une ressource
              </button>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ComponentRow({ comp, pad, edit, advance }: { comp: CompNode; pad: number; edit: Edit; advance: Advance }) {
  const trailing = (advance.active ? 5 : 0) + (edit.editable ? 1 : 0);
  if (comp.kind === 'sub_line') return null;
  if (comp.kind === 'percentage') {
    return (
      <tr className="muted">
        <td style={{ paddingLeft: pad, fontStyle: 'italic' }}>Frais généraux ({(Number(comp.rate) * 100).toLocaleString('fr-FR')} %)</td>
        <td colSpan={4 + trailing}></td>
      </tr>
    );
  }
  const n = comp.nomenclature;
  const puChanged = n && n.unitCostEtude !== n.unitCostObjectif;
  return (
    <tr className="muted">
      <td style={{ paddingLeft: pad }}>
        {n ? `${n.code} · ${n.label}` : 'Ressource'}
        {n && <span className="badge" style={{ marginLeft: 6, fontSize: 10 }}>{NATURE_LABELS[n.nature] ?? n.nature}</span>}
      </td>
      <td style={{ textAlign: 'right', fontSize: 12 }}>
        {edit.editable ? (
          <EditableNumber value={comp.quantiteObjectif} suffix={n?.unit ?? ''} onSubmit={(v) => edit.setComponentQty(comp.id, v)} disabled={edit.pending} />
        ) : (
          <>{Number(comp.quantiteObjectif).toLocaleString('fr-FR')} {n?.unit ?? ''}</>
        )}
      </td>
      <td colSpan={2} style={{ textAlign: 'right', fontSize: 12 }}>
        {edit.editable && n ? (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
            PU <EditableNumber value={n.unitCostObjectif} onSubmit={(v) => edit.renegotiate(n.id, v)} disabled={edit.pending} />
          </span>
        ) : (
          <>PU {n ? euro(n.unitCostEtude) : ''}{puChanged && n ? ` → ${euro(n.unitCostObjectif)}` : ''}</>
        )}
      </td>
      <td></td>
      {advance.active && <td></td>}
      {advance.active && <td></td>}
      {advance.active && <td></td>}
      {advance.active && <td></td>}
      {advance.active && <td></td>}
      {edit.editable && (
        <td style={{ textAlign: 'center' }}>
          <IconButton title="Supprimer la ressource" onClick={() => edit.removeComponent(comp.id)} disabled={edit.pending}><Trash2 size={12} /></IconButton>
        </td>
      )}
    </tr>
  );
}

/* ─────────── petits contrôles ─────────── */
function EditableNumber({ value, suffix, onSubmit, disabled }: { value: string; suffix?: string; onSubmit: (v: string) => void; disabled?: boolean }) {
  const [v, setV] = useState(value);
  // Resynchronise sur la valeur serveur après un enregistrement (efface l'état « modifié »).
  useEffect(() => { setV(value); }, [value]);
  const dirty = v !== value;
  const commit = () => { if (dirty && v.trim() !== '' && !Number.isNaN(Number(v))) onSubmit(v); };
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      <input
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
        style={{ width: 72, textAlign: 'right', padding: '2px 6px', borderColor: dirty ? 'var(--accent)' : undefined }}
      />
      {suffix && <span className="muted" style={{ fontSize: 11 }}>{suffix}</span>}
    </span>
  );
}

function IconButton({ children, title, onClick, disabled }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}>
      {children}
    </button>
  );
}

function GlobalAdvanceControl({ onApply, pending }: { onApply: (pctFraction: string) => void; pending: boolean }) {
  const [pct, setPct] = useState('');
  const valid = pct.trim() !== '' && Number(pct) >= 0 && Number(pct) <= 100;
  return (
    <div className="field" style={{ marginBottom: 0, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <div>
        <label>Avancement global (%)</label>
        <input type="number" min={0} max={100} step={1} value={pct} placeholder="ex. 50" onChange={(e) => setPct(e.target.value)} style={{ width: 100, textAlign: 'right' }} />
      </div>
      <button className="btn btn-secondary" style={{ fontSize: 13 }} disabled={!valid || pending}
        onClick={() => { onApply(String(Number(pct) / 100)); setPct(''); }}>
        {pending ? '…' : 'Appliquer à tous les ouvrages'}
      </button>
    </div>
  );
}

function AddResourceForm({ onSubmit, onCancel }: { onSubmit: (body: Record<string, string>) => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [unit, setUnit] = useState('');
  const [nature, setNature] = useState('material');
  const [unitCost, setUnitCost] = useState('');
  const [quantity, setQuantity] = useState('');
  const valid = code.trim() && label.trim() && unitCost.trim() && quantity.trim();
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '4px 0' }}>
      <input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} style={{ width: 90 }} />
      <input placeholder="Désignation" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 160 }} />
      <select value={nature} onChange={(e) => setNature(e.target.value)}>
        {NATURE_OPTIONS.map((n) => <option key={n} value={n}>{NATURE_LABELS[n]}</option>)}
      </select>
      <input placeholder="Unité" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: 60 }} />
      <input type="number" step="any" placeholder="PU" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} style={{ width: 80, textAlign: 'right' }} />
      <input type="number" step="any" placeholder="Qté" value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ width: 70, textAlign: 'right' }} />
      <button className="btn" style={{ fontSize: 12, padding: '3px 10px' }} disabled={!valid}
        onClick={() => onSubmit({ code: code.trim(), label: label.trim(), unit: unit.trim(), nature, unitCost, quantity })}>
        Ajouter
      </button>
      <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 10px' }} onClick={onCancel}>Annuler</button>
    </div>
  );
}

function AddOuvrageForm({ onSubmit, onCancel, pending }: { onSubmit: (body: Record<string, string>) => void; onCancel: () => void; pending: boolean }) {
  const [code, setCode] = useState('');
  const [designation, setDesignation] = useState('');
  const [unit, setUnit] = useState('');
  const [quantiteObjectif, setQuantiteObjectif] = useState('');
  const valid = designation.trim() && quantiteObjectif.trim();
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} style={{ width: 90 }} />
      <input placeholder="Désignation de l'ouvrage" value={designation} onChange={(e) => setDesignation(e.target.value)} style={{ width: 220 }} />
      <input placeholder="Unité" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: 60 }} />
      <input type="number" step="any" placeholder="Qté" value={quantiteObjectif} onChange={(e) => setQuantiteObjectif(e.target.value)} style={{ width: 70, textAlign: 'right' }} />
      <button className="btn" style={{ fontSize: 13 }} disabled={!valid || pending}
        onClick={() => onSubmit({ code: code.trim(), designation: designation.trim(), unit: unit.trim(), quantiteObjectif })}>
        {pending ? '…' : 'Ajouter'}
      </button>
      <button className="btn btn-secondary" style={{ fontSize: 13 }} onClick={onCancel}>Annuler</button>
    </div>
  );
}

/* ─────────── journal horodaté ─────────── */
interface LogEntry { id: string; action: string; detail: Record<string, unknown>; created_at: string }
const ACTION_LABELS: Record<string, string> = {
  validate_etude: 'Budget d’étude validé',
  validate_contre_etude: 'Contre-étude validée',
  renegotiate_resource: 'PU renégocié',
  set_component_quantity: 'Quantité de ressource modifiée',
  set_line_quantity: 'Quantité d’ouvrage modifiée',
  add_resource_component: 'Ressource ajoutée',
  remove_component: 'Ressource supprimée',
  add_ouvrage_line: 'Ouvrage ajouté',
  remove_line: 'Ouvrage supprimé',
};
function ChangeLog({ marcheId, token }: { marcheId: string; token: string | null }) {
  const log = useQuery({
    queryKey: ['change-log', marcheId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<LogEntry[]>(`/marches/${marcheId}/change-log`, { token }),
  });
  if (!log.data) return null;
  return (
    <div className="card" style={{ marginTop: 8, background: 'var(--bg)', padding: 12 }}>
      <strong style={{ fontSize: 13 }}>Historique horodaté</strong>
      {log.data.length === 0 ? (
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>Aucune modification enregistrée.</p>
      ) : (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }} className="muted">
          {log.data.map((e) => (
            <li key={e.id}>{dt(e.created_at)} — {ACTION_LABELS[e.action] ?? e.action}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
