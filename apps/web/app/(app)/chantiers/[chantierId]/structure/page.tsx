'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, CheckCircle2, Clock } from 'lucide-react';
import { useAuth } from '@/lib/auth';
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
const PHASE_META: Record<Phase, { label: string; badge: string }> = {
  etude: { label: "Budget d'étude", badge: 'info' },
  contre_etude: { label: 'Contre-étude', badge: 'warning' },
  execution: { label: 'Exécution', badge: 'success' },
};

function dt(s: string | null): string {
  if (!s) return '';
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

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
        <p className="muted">Ce chantier n'a pas encore de marché (aucun devis transféré).</p>
      )}

      {tree.data?.marches.map((m) => (
        <MarcheBlock key={m.id} marche={m} chantierId={chantierId} token={token} />
      ))}
    </div>
  );
}

/* ─────────── un marché ─────────── */
function MarcheBlock({ marche, chantierId, token }: { marche: MarcheTree; chantierId: string; token: string | null }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const phaseMeta = PHASE_META[marche.execution_phase];

  const validate = useMutation({
    mutationFn: (step: 'etude' | 'contre-etude') =>
      apiFetch(`/marches/${marche.id}/${step}/validate`, { method: 'POST', token }),
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ['execution-tree', chantierId] });
      qc.invalidateQueries({ queryKey: ['change-log', marche.id] });
      qc.invalidateQueries({ queryKey: ['chantier-marches', chantierId] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

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
          {marche.execution_phase === 'contre_etude' && (
            <button className="btn" disabled={validate.isPending} onClick={() => { setErr(null); validate.mutate('contre-etude'); }}>
              {validate.isPending ? '…' : 'Valider la contre-étude'}
            </button>
          )}
        </div>
      </div>

      {/* horodatage des phases */}
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
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
      {showLog && <ChangeLog marcheId={marche.id} token={token} />}

      {/* arbre */}
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table className="grid" style={{ margin: 0, minWidth: 720 }}>
          <thead>
            <tr>
              <th>Poste</th>
              <th style={{ textAlign: 'right' }}>Qté</th>
              <th style={{ textAlign: 'right' }}>Budget étude</th>
              <th style={{ textAlign: 'right' }}>Objectif</th>
              <th style={{ textAlign: 'right' }}>Prévisionnel</th>
            </tr>
          </thead>
          <tbody>
            {marche.lines.map((n) => <LineRows key={n.id} node={n} depth={0} />)}
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td><strong>Total marché</strong></td>
              <td></td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(marche.totals.etude)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(marche.totals.objectif)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(marche.totals.previsionnel)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────── une ligne d'ouvrage + ses composants (récursif) ─────────── */
function LineRows({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  const hasDetail = node.components.length > 0 || node.children.length > 0;
  const pad = 8 + depth * 20;

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
        <td style={{ textAlign: 'right' }}>{Number(node.quantiteObjectif).toLocaleString('fr-FR')} {node.unit ?? ''}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{node.budget ? euro(node.budget.etude) : ''}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{node.budget ? euro(node.budget.objectif) : ''}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{node.budget ? euro(node.budget.previsionnel) : ''}</td>
      </tr>
      {open && node.components.map((c) => <ComponentRow key={c.id} comp={c} pad={pad + 20} />)}
      {open && node.children.map((child) => <LineRows key={child.id} node={child} depth={depth + 1} />)}
    </>
  );
}

function ComponentRow({ comp, pad }: { comp: CompNode; pad: number }) {
  if (comp.kind === 'sub_line') return null; // rendu via children
  if (comp.kind === 'percentage') {
    return (
      <tr className="muted">
        <td style={{ paddingLeft: pad, fontStyle: 'italic' }}>Frais généraux ({(Number(comp.rate) * 100).toLocaleString('fr-FR')} %)</td>
        <td colSpan={4}></td>
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
      <td style={{ textAlign: 'right', fontSize: 12 }}>{Number(comp.quantiteObjectif).toLocaleString('fr-FR')} {n?.unit ?? ''}</td>
      <td colSpan={2} style={{ textAlign: 'right', fontSize: 12 }}>
        PU {n ? euro(n.unitCostEtude) : ''}{puChanged && n ? ` → ${euro(n.unitCostObjectif)}` : ''}
      </td>
      <td></td>
    </tr>
  );
}

/* ─────────── journal horodaté ─────────── */
interface LogEntry { id: string; action: string; detail: Record<string, unknown>; created_at: string }
const ACTION_LABELS: Record<string, string> = {
  validate_etude: 'Budget d’étude validé',
  validate_contre_etude: 'Contre-étude validée',
  renegotiate_resource: 'PU renégocié',
  set_component_quantity: 'Quantité modifiée',
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
            <li key={e.id}>
              {dt(e.created_at)} — {ACTION_LABELS[e.action] ?? e.action}
              {e.detail && Object.keys(e.detail).length > 0 && (
                <span> ({Object.entries(e.detail).map(([k, v]) => `${k}: ${String(v)}`).join(', ')})</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
