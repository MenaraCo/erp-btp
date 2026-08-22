'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, ChevronDown, ChevronRight, ShoppingCart } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';
import { Alerte, Bouton, CarteKpi } from '@/components/ui';

interface Budget { etude: string; objectif: string; previsionnel: string }
interface TreeNode {
  id: string; code: string | null; designation: string; unit: string | null;
  quantiteObjectif: string; engage: string; realise: string;
  budget: Budget | null; children: TreeNode[];
}
type Phase = 'etude' | 'contre_etude' | 'execution';
interface MarcheTree { id: string; code: string; name: string; execution_phase: Phase; totals: Budget; lines: TreeNode[] }
interface ExecutionTree { chantier: { code: string }; marches: MarcheTree[] }
interface PrevuRow { execution_line_id: string; pct: string }
interface ConstateRow { execution_line_id: string; pct: string }

/** Premier et dernier jour du mois qui suit la date donnée : la période qui commence. */
function moisSuivant(base = new Date()): { debut: string; fin: string } {
  const d = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const f = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { debut: iso(d), fin: iso(f) };
}
function pctTexte(f: number | null): string {
  return f == null ? '—' : `${(f * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

/**
 * AVANCEMENT PRÉVU — ce qu'on compte réaliser sur la période qui commence (guide §19).
 *
 * Le constaté regarde derrière, le prévu regarde devant, et ne sert pas à la même chose : il
 * quantifie les BESOINS de la période — de la main-d'œuvre à mobiliser, des matériaux à commander.
 * Sans lui, l'approvisionnement se fait au jugé et l'on découvre en fin de mois qu'on a commandé
 * pour deux périodes.
 *
 * La prévision ne remplace jamais le constat : les deux se lisent côte à côte, et c'est leur écart
 * qui apprend quelque chose.
 */
export default function AvancementPrevuPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const chantierId = String(useParams().chantierId);
  const [periode, setPeriode] = useState(moisSuivant());
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
  const prevu = useQuery({
    queryKey: ['avancement-prevu', chantierId, periode.debut, periode.fin],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<PrevuRow[]>(
      `/chantiers/${chantierId}/avancement-prevu?debut=${periode.debut}&fin=${periode.fin}`, { token },
    ),
  });
  const constate = useQuery({
    queryKey: ['line-advancement', chantierId],
    enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<ConstateRow[]>(`/chantiers/${chantierId}/line-advancement`, { token }),
  });

  const mPrevu = useMutation({
    mutationFn: ({ id, pct }: { id: string; pct: string }) =>
      apiFetch(`/chantiers/${chantierId}/avancement-prevu`, {
        method: 'POST', token,
        body: { executionLineId: id, pct, debut: periode.debut, fin: periode.fin },
      }),
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ['avancement-prevu', chantierId, periode.debut, periode.fin] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const pctByLine = new Map((prevu.data ?? []).map((r) => [r.execution_line_id, Number(r.pct)]));
  const constateByLine = new Map((constate.data ?? []).map((r) => [r.execution_line_id, Number(r.pct)]));

  const besoin = useMemo(() => {
    let total = 0;
    for (const m of tree.data?.marches ?? []) {
      for (const l of m.lines) {
        total += l.budget ? Number(l.budget.objectif) * (pctByLine.get(l.id) ?? 0) : 0;
      }
    }
    return total;
  }, [tree.data, prevu.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (tree.isError) {
    return (
      <div>
        <p className="muted" style={{ marginTop: 0 }}>
          <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {chantier.data?.code ?? ''}</Link>
        </p>
        <h1>Avancement prévu</h1>
        <p className="muted">Chantier introuvable, ou suivi de chantiers non autorisé.</p>
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
          <h1 style={{ marginBottom: 4 }}>Avancement prévu</h1>
          <p className="muted" style={{ marginTop: 0, maxWidth: 780 }}>
            Ce que vous comptez réaliser sur la <strong>période qui commence</strong>, ouvrage par ouvrage. Le
            montant qui en découle est le <strong>besoin de la période</strong> : la main-d'œuvre à mobiliser et
            les matériaux à commander. Le prévu ne remplace pas le constat — c'est leur écart qui apprend
            quelque chose.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>
              <CalendarRange size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Du
            </label>
            <input type="date" value={periode.debut}
              onChange={(e) => setPeriode((p) => ({ ...p, debut: e.target.value }))} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>au</label>
            <input type="date" value={periode.fin}
              onChange={(e) => setPeriode((p) => ({ ...p, fin: e.target.value }))} />
          </div>
        </div>
      </div>

      {err && <Alerte>{err}</Alerte>}

      <div className="card-grid" style={{ marginTop: 12 }}>
        <CarteKpi titre="Besoin de la période" valeur={euro(besoin)} icone={CalendarRange}
          detail="Budget objectif × avancement prévu" />
        <CarteKpi titre="Ouvrages concernés" valeur={String(pctByLine.size)}
          detail="Ceux qui portent une prévision" />
        <div className="card">
          <h2>Commander</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
            Les besoins se transforment en commandes dans l'écran d'approvisionnement, qui sait déjà
            ce qui est déjà commandé.
          </p>
          <Bouton variante="secondaire" icone={ShoppingCart}
            onClick={() => { window.location.href = `/chantiers/${chantierId}/achats`; }}>
            Approvisionnement
          </Bouton>
        </div>
      </div>

      {tree.data?.marches.length === 0 && (
        <p className="muted">Ce chantier n'a pas encore de marché : rien à prévoir.</p>
      )}

      {tree.data?.marches.map((m) => (
        <div key={m.id} className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Marché {m.code}</h2>
            <span className="muted">{m.name}</span>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table className="grid" style={{ margin: 0, minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Ouvrage</th>
                  <th style={{ textAlign: 'right' }}>Qté</th>
                  <th style={{ textAlign: 'right' }}>Budget objectif</th>
                  <th style={{ textAlign: 'right' }}>Déjà constaté</th>
                  <th style={{ textAlign: 'right' }}>Prévu sur la période</th>
                  <th style={{ textAlign: 'right' }}>Besoin</th>
                </tr>
              </thead>
              <tbody>
                {m.lines.map((n) => (
                  <LignePrevue key={n.id} node={n} depth={0} pctByLine={pctByLine}
                    constateByLine={constateByLine} pending={mPrevu.isPending}
                    onPrevu={(id, pct) => mPrevu.mutate({ id, pct })} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function LignePrevue({
  node, depth, pctByLine, constateByLine, pending, onPrevu,
}: {
  node: TreeNode;
  depth: number;
  pctByLine: Map<string, number>;
  constateByLine: Map<string, number>;
  pending: boolean;
  onPrevu: (lineId: string, pctFraction: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const pct = pctByLine.get(node.id) ?? 0;
  const objectif = node.budget ? Number(node.budget.objectif) : 0;
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
        <td style={{ textAlign: 'right' }} className="muted">
          {node.budget ? pctTexte(constateByLine.get(node.id) ?? 0) : ''}
        </td>
        <td style={{ textAlign: 'right' }}>
          {node.budget && (
            <SaisiePct value={pct} disabled={pending} onSubmit={(f) => onPrevu(node.id, f)} />
          )}
        </td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {node.budget ? euro(objectif * pct) : ''}
        </td>
      </tr>
      {open && node.children.map((child) => (
        <LignePrevue key={child.id} node={child} depth={depth + 1} pctByLine={pctByLine}
          constateByLine={constateByLine} pending={pending} onPrevu={onPrevu} />
      ))}
    </>
  );
}

/** Saisie d'un % prévu : validée à la sortie du champ ou par Entrée. */
function SaisiePct({ value, disabled, onSubmit }: { value: number; disabled: boolean; onSubmit: (fraction: string) => void }) {
  const affiche = String(Math.round(value * 1000) / 10);
  const [v, setV] = useState(affiche);
  useEffect(() => { setV(affiche); }, [affiche]);
  const dirty = v !== affiche;
  return (
    <input
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (!dirty || v.trim() === '') return;
        const f = Number(v.replace(',', '.')) / 100;
        if (f >= 0 && f <= 1) onSubmit(String(f));
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{ width: 72, textAlign: 'right', padding: '2px 6px', borderColor: dirty ? 'var(--accent)' : undefined }}
    />
  );
}
