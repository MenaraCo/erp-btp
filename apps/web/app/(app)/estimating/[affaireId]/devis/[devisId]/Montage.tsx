'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { fmtEuro, fmtNum, cleanNum } from '@/lib/preferences';
import { visibleForClient } from '@/lib/client-view';

export interface SaleLineInfo { pv: string; forced: boolean }
export type NatureBreak = Record<'labor' | 'material' | 'equipment' | 'subcontract', string>;

export interface DragItem {
  kind: 'ouvrage' | 'ressource' | 'titre' | 'sous_titre';
  id: string; code: string; label: string; unit: string | null;
  debourse?: string; codeAnalytique?: string | null;
  sourceOuvrageId?: string | null;
  /** true si l'item vient du panneau Bibliothèque (id = id biblio ouvrage/ressource). */
  fromLibrary?: boolean;
}

export interface MontageLine {
  id: string;
  parent_line_id: string | null;
  type: string;
  code: string | null;
  code_analytique: string | null;
  designation: string;
  unit: string | null;
  quantity: string | null;
  pu: string | null;
  perte: string | null;
  cadence: string | null;
  prix_public: string | null;
  nature: string | null;
  debourse_type_id?: string | null;
  section_type: 'option' | 'variante' | null;
  source_ouvrage_id: string | null;
  source_resource_id: string | null;
  sort_order: number;
  numero?: string | null;
  num_custom?: string | null;
  /** Type de sous-traitance (défini par devis) auquel la ligne est rattachée. */
  st_type_id?: string | null;
  /** false = ligne de FRAIS : son déboursé est ventilé sur les lignes vendables. */
  vendable?: boolean;
  /** Assiette de ventilation des frais : 'propre' | 'st' | 'all'. */
  ventilation_base?: 'propre' | 'st' | 'all' | null;
  /** Champs d'achat copiés de la biblio à l'ajout, puis éditables au niveau du devis. */
  unite_achat?: string | null;
  coeff_conversion?: string | null;
  supplier_id?: string | null;
  ref_fournisseur?: string | null;
  conditionnement?: string | null;
}

/** Gabarit de colonnes du sous-détail (déboursé) — aligné, ordre : marqueurs · Code · Désignation ·
 * Unité · Perte · Qté · Cadence · P.U. Public · P.U. Déboursé · Montant · actions.
 * La nature n'est plus une colonne : elle s'édite dans la fiche ressource (double-clic / ⓘ), comme
 * dans la bibliothèque, pour gagner de la place. */
const SD_GRID: React.CSSProperties = {
  display: 'grid',
  // 11 colonnes : marqueurs · Code · Désignation · Unité · Perte · Qté · Cadence · P.U. Public ·
  // P.U. Déb. · Montant. Les actions sont un bandeau flottant en surimpression (hors grille) :
  // masquées au repos → toute la largeur va aux colonnes ; visibles au survol.
  gridTemplateColumns: '14px 18px 66px minmax(140px,1fr) 46px 38px 48px 42px 64px 58px 78px',
  alignItems: 'stretch',
  columnGap: 0,
};
/** En mode VENTE, le P.U. est saisissable : les actions prennent leur PROPRE colonne (au lieu du
 * bandeau flottant) pour ne jamais recouvrir la cellule de prix. */
const SD_GRID_VENTE: React.CSSProperties = {
  ...SD_GRID,
  gridTemplateColumns: '14px 18px 66px minmax(140px,1fr) 46px 38px 48px 42px 64px 58px 78px 124px',
};
const CELL_CTR: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center' };

/** Entrée dans une cellule → saute à la même colonne de la ligne suivante DE MÊME NIVEAU
 * (les inputs portent data-cell="<type>:<champ>"). Le blur de la cellule quittée valide la saisie. */
function focusNextCell(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const cell = e.currentTarget.dataset.cell;
  const root = e.currentTarget.closest('.deb-table');
  if (!cell || !root) { e.currentTarget.blur(); return; }
  const nodes = Array.from(root.querySelectorAll<HTMLInputElement>(`input[data-cell="${cell}"]`));
  const next = nodes[nodes.indexOf(e.currentTarget) + 1];
  if (next) { next.focus(); next.select(); }
  else e.currentTarget.blur();
}

/** En-tête de colonnes du déboursé (affiché une seule fois, collant en haut du corps). */
function DeboursHeader() {
  return (
    <div className="sd-head" style={{ ...SD_GRID, position: 'sticky', top: 0, zIndex: 5, background: '#eef2f7', padding: '3px 6px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 700, borderTop: '1px solid #dbe2ea', borderBottom: '1px solid #dbe2ea' }}>
      <span /><span />
      <span style={{ paddingLeft: 4 }}>Code</span>
      <span style={{ paddingLeft: 4 }}>Désignation</span>
      <span style={{ justifyContent: 'center' }}>Unité</span>
      <span style={{ justifyContent: 'flex-end', paddingRight: 4 }}>Perte</span>
      <span style={{ justifyContent: 'flex-end', paddingRight: 4 }}>Qté</span>
      <span style={{ justifyContent: 'flex-end', paddingRight: 4 }}>Cad.</span>
      <span style={{ justifyContent: 'flex-end', paddingRight: 4 }}>P.U. Public</span>
      <span style={{ justifyContent: 'flex-end', paddingRight: 4 }}>P.U. Déb.</span>
      <span style={{ justifyContent: 'flex-end', paddingRight: 4 }}>Montant</span>
    </div>
  );
}

/** Drag context passed down the tree. Separates internal-reorder drag from library drag. */
interface DragCtx {
  dragLineId: string | null;
  setDragLineId: (id: string | null) => void;
  allLines: MontageLine[];
  onReorder: (parentLineId: string | null, dragId: string, beforeId: string | null) => void;
}

/** Thin visible separator between siblings — becomes a blue drop target during internal drag. */
function DropZone({
  beforeLineId, parentLineId, dragCtx,
}: {
  beforeLineId: string | null;
  parentLineId: string | null;
  dragCtx: DragCtx;
}) {
  const [over, setOver] = useState(false);
  const { dragLineId, setDragLineId, allLines, onReorder } = dragCtx;

  if (!dragLineId) return null;
  const dragged = allLines.find((l) => l.id === dragLineId);
  if (!dragged || dragged.parent_line_id !== parentLineId) return null;
  if (dragLineId === beforeLineId) return null;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as HTMLElement)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation();
        setOver(false);
        onReorder(parentLineId, dragLineId, beforeLineId);
        setDragLineId(null);
      }}
      style={{ padding: '3px 0', cursor: 'default' }}
    >
      <div style={{
        height: over ? 4 : 2,
        borderRadius: 2,
        background: over ? 'var(--primary)' : 'rgba(148,163,184,0.25)',
        boxShadow: over ? '0 0 8px rgba(26,58,92,0.35)' : 'none',
        transition: 'all 0.1s',
      }} />
    </div>
  );
}

function levelStyle(depth: number) {
  const cfgs = [
    { bg: 'var(--primary)', color: '#fff', num: 'rgba(255,255,255,0.7)' },
    { bg: '#e2e8f0', color: 'var(--primary)', num: 'var(--accent)' },
    { bg: '#eef2f7', color: 'var(--primary)', num: 'var(--accent)' },
    { bg: '#f1f5f9', color: '#334155', num: 'var(--accent)' },
  ];
  return cfgs[Math.min(depth, cfgs.length - 1)];
}
const SECTION_BG: Record<string, string> = { option: '#faf5ff', variante: '#fff7ed' };
const SECTION_BORDER: Record<string, string> = { option: '#a855f7', variante: '#f97316' };

export function Montage({
  versionId, token, lines, deboursById, natureById, onChanged, readOnly,
  mode = 'debours', saleById, decimals = 2, acceptDrop = false,
}: {
  versionId: string; token: string | null; lines: MontageLine[];
  deboursById: Map<string, string>; natureById?: Map<string, NatureBreak>;
  onChanged: () => void; readOnly: boolean;
  mode?: 'debours' | 'vente'; saleById?: Map<string, SaleLineInfo>;
  decimals?: number; acceptDrop?: boolean;
}) {
  const vente = mode === 'vente';
  // En vue client, les lignes de frais (FP / FS / F*) n'existent pas : leur coût est déjà réparti
  // dans les prix. On les retire de l'arbre — et avec elles les titres qui ne contiendraient
  // qu'elles — exactement comme à l'aperçu et au PDF.
  const clientVisible = useMemo(() => (vente ? visibleForClient(lines) : null), [vente, lines]);
  const childrenOf = (pid: string | null) =>
    lines
      .filter((l) => l.parent_line_id === pid && (!clientVisible || clientVisible.has(l.id)))
      .sort((a, b) => a.sort_order - b.sort_order);

  const subtree = (l: MontageLine): number => {
    if (l.type === 'ouvrage' || l.type === 'ressource') return Number(deboursById.get(l.id) ?? 0);
    return childrenOf(l.id).reduce((s, c) => s + subtree(c), 0);
  };
  const valueOf = (l: MontageLine): number => {
    if (!vente) return subtree(l);
    if (l.type === 'ouvrage' || l.type === 'ressource') return Number(saleById?.get(l.id)?.pv ?? 0);
    return childrenOf(l.id).reduce((s, c) => s + valueOf(c), 0);
  };
  const sectionOf = (l: MontageLine): 'option' | 'variante' | null => {
    let cur: MontageLine | undefined = l;
    while (cur) {
      if (cur.section_type) return cur.section_type;
      cur = cur.parent_line_id ? lines.find((x) => x.id === cur!.parent_line_id) : undefined;
    }
    return null;
  };

  const addLine = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/versions/${versionId}/lines`, { method: 'POST', body, token }),
    onSuccess: onChanged,
  });
  const insertOuvrage = useMutation({
    mutationFn: (body: { ouvrageId: string; parentLineId: string | null; quantity: string }) =>
      apiFetch(`/versions/${versionId}/ouvrages`, { method: 'POST', body, token }),
    onSuccess: onChanged,
  });
  const updateLine = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch(`/lines/${id}`, { method: 'PATCH', body: patch, token }),
    onSuccess: onChanged,
  });
  const deleteLine = useMutation({
    mutationFn: (id: string) => apiFetch(`/lines/${id}`, { method: 'DELETE', token }),
    onSuccess: onChanged,
  });
  const setSection = useMutation({
    mutationFn: ({ id, sectionType }: { id: string; sectionType: 'option' | 'variante' | null }) =>
      apiFetch(`/lines/${id}/section`, { method: 'PUT', body: { sectionType }, token }),
    onSuccess: onChanged,
  });
  const setLinePv = useMutation({
    mutationFn: ({ lineId, puVente, force }: { lineId: string; puVente: string | null; force: boolean }) =>
      apiFetch(`/versions/${versionId}/lines/${lineId}/pv`, { method: 'PUT', body: { puVente, force }, token }),
    onSuccess: onChanged,
  });
  const reorderLines = useMutation({
    mutationFn: ({ parentLineId, orderedIds }: { parentLineId: string | null; orderedIds: string[] }) =>
      apiFetch(`/versions/${versionId}/lines/reorder`, { method: 'PUT', body: { parentLineId, orderedIds }, token }),
    onSuccess: onChanged,
  });
  const duplicateLine = useMutation({
    mutationFn: ({ lineId, keepCode }: { lineId: string; keepCode: boolean }) =>
      apiFetch<{ duplicatedId: string }>(`/lines/${lineId}/duplicate`, { method: 'POST', body: { keepCode }, token }),
    onSuccess: onChanged,
  });

  const [infoLine, setInfoLine] = useState<MontageLine | null>(null);
  // Library drag-drop
  const [libDragOverId, setLibDragOverId] = useState<string | null>(null);
  const [libDragActive, setLibDragActive] = useState(false);
  // Internal reorder drag
  const [dragLineId, setDragLineId] = useState<string | null>(null);
  // Copy/move modal
  const [copyMoveSource, setCopyMoveSource] = useState<MontageLine | null>(null);

  const onDropItem = (parentId: string | null, item: DragItem) => {
    if (item.kind === 'ouvrage') {
      // Ouvrage biblio (fromLibrary → id = ouvrage biblio) ou déplacement d'un ouvrage biblio existant
      // (sourceOuvrageId) : on COPIE le sous-détail. Un ouvrage manuel déplacé reste une ligne simple.
      const ouvrageId = item.fromLibrary ? item.id : item.sourceOuvrageId ?? null;
      if (ouvrageId) {
        insertOuvrage.mutate({ ouvrageId, parentLineId: parentId, quantity: '1' });
      } else {
        addLine.mutate({ type: 'ouvrage', parentLineId: parentId, designation: item.label, code: item.code, unit: item.unit ?? '', quantity: '1' });
      }
    } else if (item.kind === 'titre' || item.kind === 'sous_titre') {
      addLine.mutate({ type: item.kind, parentLineId: item.kind === 'sous_titre' ? parentId : null, designation: item.label, sortOrder: 9999 });
    } else {
      // Ressource biblio : conserver le lien source_resource_id (appro, achats, transfert en dépendent).
      addLine.mutate({
        type: 'ressource', parentLineId: parentId, designation: item.label, code: item.code,
        codeAnalytique: item.codeAnalytique ?? null, unit: item.unit ?? '', quantity: '1',
        pu: item.debourse ?? '0', sourceResourceId: item.fromLibrary ? item.id : null,
      });
    }
  };

  const onReorder = (parentLineId: string | null, dragId: string, beforeId: string | null) => {
    const siblings = lines
      .filter((l) => l.parent_line_id === parentLineId)
      .sort((a, b) => a.sort_order - b.sort_order);
    const dragged = siblings.find((s) => s.id === dragId);
    if (!dragged) return;
    const others = siblings.filter((s) => s.id !== dragId);
    const insertIdx = beforeId != null ? others.findIndex((s) => s.id === beforeId) : others.length;
    const idx = insertIdx === -1 ? others.length : insertIdx;
    const newOrder = [...others.slice(0, idx), dragged, ...others.slice(idx)];
    reorderLines.mutate({ parentLineId, orderedIds: newOrder.map((s) => s.id) });
  };

  const dragCtx: DragCtx = { dragLineId, setDragLineId, allLines: lines, onReorder };
  const roots = childrenOf(null);

  return (
    <div
      className="deb-table"
      onDragEnter={(e) => {
        if (!acceptDrop) return;
        if (e.dataTransfer.types.includes('application/json')) setLibDragActive(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as HTMLElement)) {
          setLibDragActive(false); setLibDragOverId(null);
        }
      }}
      onDragOver={(e) => {
        if (acceptDrop && e.dataTransfer.types.includes('application/json')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!acceptDrop) return;
        if (e.dataTransfer.types.includes('application/json')) {
          e.preventDefault(); setLibDragActive(false); setLibDragOverId(null);
        }
      }}
    >
      {!vente && roots.length > 0 && <DeboursHeader />}
      {roots.map((l) => (
        <Fragment key={l.id}>
          <DropZone beforeLineId={l.id} parentLineId={null} dragCtx={dragCtx} />
          <Node
            line={l} depth={0} childrenOf={childrenOf} subtree={subtree} sectionOf={sectionOf}
            token={token} versionId={versionId} readOnly={readOnly}
            addLine={addLine} insertOuvrage={insertOuvrage} updateLine={updateLine}
            deleteLine={deleteLine} setSection={setSection}
            reorderLines={reorderLines} duplicateLine={duplicateLine}
            vente={vente} valueOf={valueOf} saleById={saleById} setLinePv={setLinePv}
            decimals={decimals} deboursById={deboursById} natureById={natureById}
            onShowInfo={setInfoLine}
            libDragActive={libDragActive} libDragOverId={libDragOverId}
            setLibDragOverId={setLibDragOverId} onDropItem={onDropItem}
            dragCtx={dragCtx} onCopyMove={setCopyMoveSource}
          />
        </Fragment>
      ))}
      <DropZone beforeLineId={null} parentLineId={null} dragCtx={dragCtx} />

      {/* Pied de tableau : total général, aligné sur la grille (déboursé HT ou PV HT). */}
      {roots.length > 0 && (() => {
        const total = roots.reduce((sum, l) => sum + valueOf(l), 0);
        // En déboursé, on rappelle la répartition travaux directs / sous-traitance.
        let directs = 0;
        let st = 0;
        if (!vente && natureById) {
          for (const [, nb] of natureById) {
            directs += Number(nb.labor) + Number(nb.material) + Number(nb.equipment);
            st += Number(nb.subcontract);
          }
        }
        return (
          <div className="sd-row sd-total" style={{ ...(vente ? SD_GRID_VENTE : SD_GRID), padding: '0 6px', marginTop: 4 }}>
            <span /><span /><span />
            <span style={{ gridColumn: '4 / 11', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', fontSize: 11 }}>
              {vente ? 'Total prix de vente HT' : 'Total déboursé HT'}
              {!vente && (directs > 0 || st > 0) && (
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.75, marginLeft: 10, fontSize: 10 }}>
                  travaux directs {fmtEuro(directs, decimals)} · sous-traitance {fmtEuro(st, decimals)}
                </span>
              )}
            </span>
            <span style={{ justifyContent: 'flex-end', fontWeight: 800, fontVariantNumeric: 'tabular-nums', paddingRight: 4 }}>
              {fmtEuro(total, decimals)}
            </span>
            {vente && <span />}
          </div>
        );
      })()}

      {!readOnly && (
        <button className="btn" style={{ marginTop: 8 }}
          onClick={() => addLine.mutate({ type: 'titre', designation: 'Nouveau titre', sortOrder: roots.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1 })}>
          + Titre
        </button>
      )}
      {infoLine && (() => {
        // Toujours repartir de la ligne À JOUR (infoLine est un instantané pris au clic :
        // après une modification, il serait périmé et la fiche réafficherait l'ancienne valeur).
        const fresh = lines.find((l) => l.id === infoLine.id) ?? infoLine;
        return (
        <LineInfoModal
          key={`${fresh.id}:${fresh.quantity}:${fresh.pu}:${fresh.perte}:${fresh.unit}:${fresh.nature}:${fresh.code_analytique}`}
          line={fresh}
          components={fresh.type === 'ouvrage' ? childrenOf(fresh.id) : []}
          deboursById={deboursById}
          decimals={decimals}
          token={token}
          versionId={versionId}
          readOnly={readOnly}
          updateLine={updateLine}
          onClose={() => setInfoLine(null)}
        />
        );
      })()}
      {copyMoveSource && (
        <CopyMoveModal
          source={copyMoveSource}
          allLines={lines}
          onClose={() => setCopyMoveSource(null)}
          onDuplicate={(keepCode, destParentId) => {
            duplicateLine.mutate(
              { lineId: copyMoveSource.id, keepCode },
              {
                onSuccess: async (res) => {
                  if (res && destParentId !== copyMoveSource.parent_line_id) {
                    await apiFetch(`/lines/${res.duplicatedId}`, { method: 'PATCH', body: { parentLineId: destParentId }, token });
                    onChanged();
                  }
                },
              },
            );
          }}
          onMove={(destParentId, clearCode) => {
            const patch: Record<string, unknown> = { parentLineId: destParentId };
            if (clearCode) patch.code = null;
            updateLine.mutate({ id: copyMoveSource.id, patch });
          }}
        />
      )}
    </div>
  );
}

type Muts = {
  addLine: ReturnType<typeof useMutation<unknown, Error, Record<string, unknown>>>;
  insertOuvrage: ReturnType<typeof useMutation<unknown, Error, { ouvrageId: string; parentLineId: string | null; quantity: string }>>;
  updateLine: ReturnType<typeof useMutation<unknown, Error, { id: string; patch: Record<string, unknown> }>>;
  deleteLine: ReturnType<typeof useMutation<unknown, Error, string>>;
  setSection: ReturnType<typeof useMutation<unknown, Error, { id: string; sectionType: 'option' | 'variante' | null }>>;
  reorderLines: ReturnType<typeof useMutation<unknown, Error, { parentLineId: string | null; orderedIds: string[] }>>;
  duplicateLine: ReturnType<typeof useMutation<{ duplicatedId: string } | null, Error, { lineId: string; keepCode: boolean }>>;
};

type LibDragCtx = {
  libDragActive: boolean;
  libDragOverId: string | null;
  setLibDragOverId: (id: string | null) => void;
  onDropItem: (parentId: string | null, item: DragItem) => void;
};

type VenteCtx = {
  vente: boolean;
  valueOf: (l: MontageLine) => number;
  saleById?: Map<string, SaleLineInfo>;
  setLinePv: ReturnType<typeof useMutation<unknown, Error, { lineId: string; puVente: string | null; force: boolean }>>;
  decimals: number;
  deboursById: Map<string, string>;
  natureById?: Map<string, NatureBreak>;
  onShowInfo: (l: MontageLine) => void;
  dragCtx: DragCtx;
  onCopyMove: (line: MontageLine) => void;
} & LibDragCtx;

function DragHandle({ lineId, dragCtx, crossPanel }: { lineId: string; dragCtx: DragCtx; crossPanel?: DragItem }) {
  return (
    <span
      title="Réorganiser (glisser-déposer)"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-line-id', lineId);
        e.dataTransfer.effectAllowed = 'move';
        dragCtx.setDragLineId(lineId);
        if (crossPanel) e.dataTransfer.setData('application/json', JSON.stringify(crossPanel));
      }}
      onDragEnd={() => dragCtx.setDragLineId(null)}
      style={{ cursor: 'grab', fontSize: 14, flexShrink: 0, userSelect: 'none', lineHeight: 1, padding: '0 2px' }}
    >⠿</span>
  );
}

function Node({
  line, depth, childrenOf, subtree, sectionOf, token, versionId, readOnly,
  addLine, insertOuvrage, updateLine, deleteLine, setSection, reorderLines, duplicateLine,
  vente, valueOf, saleById, setLinePv, decimals, deboursById, natureById, onShowInfo,
  libDragActive, libDragOverId, setLibDragOverId, onDropItem,
  dragCtx, onCopyMove,
}: {
  line: MontageLine; depth: number;
  childrenOf: (pid: string | null) => MontageLine[];
  subtree: (l: MontageLine) => number;
  sectionOf: (l: MontageLine) => 'option' | 'variante' | null;
  token: string | null; versionId: string; readOnly: boolean;
} & Muts & VenteCtx) {
  const kids = childrenOf(line.id);
  const sect = line.section_type;
  // Plus d'indentation par profondeur : tout est aligné sur une seule grille (comme ONAYA).
  // La hiérarchie reste lisible via le marqueur [T]/[O]/[R], la numérotation et la teinte des titres.
  const pad = 0;
  const vctx: VenteCtx = {
    vente, valueOf, saleById, setLinePv, decimals, deboursById, natureById, onShowInfo,
    libDragActive, libDragOverId, setLibDragOverId, onDropItem, dragCtx, onCopyMove,
  };
  const fmtV = (n: number) => fmtEuro(n, decimals);
  const isDragging = dragCtx.dragLineId === line.id;

  if (line.type === 'titre' || line.type === 'sous_titre') {
    const ls = levelStyle(depth);
    const isLibDrop = libDragActive && libDragOverId === line.id;
    const isLibZone = libDragActive && libDragOverId !== line.id;
    return (
      <div
        onDragOver={(e) => {
          if (acceptDrop(e) && libDragActive) { e.preventDefault(); e.stopPropagation(); setLibDragOverId(line.id); }
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as HTMLElement)) setLibDragOverId(null);
        }}
        onDrop={(e) => {
          if (e.dataTransfer.types.includes('application/json')) {
            e.preventDefault(); e.stopPropagation();
            const raw = e.dataTransfer.getData('application/json');
            if (raw) { try { onDropItem(line.id, JSON.parse(raw)); } catch {} }
            setLibDragOverId(null);
          }
        }}
        style={{
          marginLeft: pad, marginBottom: 6,
          borderLeft: sect ? `3px solid ${SECTION_BORDER[sect]}` : isLibDrop ? '3px solid var(--accent)' : isLibZone ? '3px dashed #cbd5e1' : '3px solid transparent',
          background: sect ? SECTION_BG[sect] : undefined, borderRadius: 6,
          outline: isLibDrop ? '2px dashed var(--accent)' : undefined, outlineOffset: -2,
          opacity: isDragging ? 0.4 : 1,
        }}
      >
        <div className={`title-row title-row-${depth} sd-title`} style={{ ...(vente ? SD_GRID_VENTE : SD_GRID), padding: '3px 6px', background: ls.bg, color: ls.color, borderRadius: 4 }}>
          <span style={CELL_CTR}>{!readOnly && <DragHandle lineId={line.id} dragCtx={dragCtx} crossPanel={{ kind: line.type as 'titre' | 'sous_titre', id: line.id, code: line.code ?? '', label: line.designation, unit: null }} />}</span>
          <span />
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: ls.num, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{line.numero ?? ''}</span>
            {!readOnly && (
              <input title="N° personnalisé" placeholder={line.numero ?? 'N°'} defaultValue={line.num_custom ?? ''}
                onBlur={(e) => (e.target.value || '') !== (line.num_custom ?? '') && updateLine.mutate({ id: line.id, patch: { numCustom: e.target.value } })}
                style={{ width: 34, fontSize: 11, fontFamily: 'monospace', textAlign: 'center', color: ls.color }} />
            )}
          </span>
          <input className="title-input" data-cell="titre:designation" onKeyDown={focusNextCell} key={line.designation} defaultValue={line.designation} disabled={readOnly} title={line.designation}
            onBlur={(e) => e.target.value !== line.designation && updateLine.mutate({ id: line.id, patch: { designation: e.target.value } })}
            style={{ gridColumn: '4 / 11', fontWeight: line.type === 'titre' ? 700 : 600, textTransform: line.type === 'titre' ? 'uppercase' : 'none', width: '100%', minWidth: 0, background: 'transparent', color: ls.color }} />
          <span style={{ display: 'flex', justifyContent: 'flex-end', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: ls.color, paddingRight: 4 }}>{fmtV(valueOf(line))}</span>
          <span className={vente ? 'sd-actions-col' : 'sd-actions'} style={vente ? undefined : { background: `linear-gradient(90deg, transparent, ${ls.bg} 38%, ${ls.bg})` }}>
            {!readOnly && (
              <>
                <SectionActions parentId={line.id} childCount={kids.length} depth={depth} addLine={addLine} headerColor={ls.color} />
                {!vente && <FraisMenu line={line} updateLine={updateLine} color={ls.color} />}
                <button title="Copier / Déplacer" onClick={() => onCopyMove(line)} style={{ ...togBtn(false, 'rgba(255,255,255,0.5)'), fontSize: 13 }}>⧉</button>
                <button title="Variante" onClick={() => setSection.mutate({ id: line.id, sectionType: sect === 'variante' ? null : 'variante' })} style={togBtn(sect === 'variante', '#f97316')}>V</button>
                <button title="Option" onClick={() => setSection.mutate({ id: line.id, sectionType: sect === 'option' ? null : 'option' })} style={togBtn(sect === 'option', '#a855f7')}>O</button>
                <button title="Supprimer" className="btn-ghost" onClick={() => deleteLine.mutate(line.id)} style={{ color: ls.color }}>✕</button>
              </>
            )}
          </span>
        </div>
        {kids.map((k) => (
          <Fragment key={k.id}>
            <DropZone beforeLineId={k.id} parentLineId={line.id} dragCtx={dragCtx} />
            <Node line={k} depth={depth + 1} childrenOf={childrenOf} subtree={subtree} sectionOf={sectionOf}
              token={token} versionId={versionId} readOnly={readOnly}
              addLine={addLine} insertOuvrage={insertOuvrage} updateLine={updateLine}
              deleteLine={deleteLine} setSection={setSection} reorderLines={reorderLines} duplicateLine={duplicateLine}
              {...vctx} />
          </Fragment>
        ))}
        <DropZone beforeLineId={null} parentLineId={line.id} dragCtx={dragCtx} />
      </div>
    );
  }

  if (line.type === 'ouvrage') {
    const comps = childrenOf(line.id);
    const info = saleById?.get(line.id);
    const qtyN = Number(line.quantity) || 0;
    const puVente = vente && info && qtyN ? Number(info.pv) / qtyN : null;
    const ouvrSect = line.section_type;
    const isLibDrop = libDragActive && libDragOverId === line.id;
    return (
      <div
        onDragOver={(e) => {
          if (acceptDrop(e) && libDragActive) { e.preventDefault(); e.stopPropagation(); setLibDragOverId(line.id); }
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as HTMLElement)) setLibDragOverId(null);
        }}
        onDrop={(e) => {
          if (e.dataTransfer.types.includes('application/json')) {
            e.preventDefault(); e.stopPropagation();
            const raw = e.dataTransfer.getData('application/json');
            if (raw) {
              try {
                const item: DragItem = JSON.parse(raw);
                onDropItem(item.kind === 'ressource' ? line.id : line.parent_line_id, item);
              } catch {}
            }
            setLibDragOverId(null);
          }
        }}
        style={{
          marginLeft: pad,
          borderLeft: ouvrSect ? `3px solid ${SECTION_BORDER[ouvrSect]}` : isLibDrop ? '3px solid var(--accent)' : undefined,
          background: ouvrSect ? SECTION_BG[ouvrSect] : undefined,
          borderRadius: ouvrSect || isLibDrop ? 6 : undefined,
          marginBottom: ouvrSect ? 4 : undefined,
          outline: isLibDrop ? '2px dashed var(--accent)' : undefined,
          opacity: isDragging ? 0.4 : 1,
        }}>
        <div className="sd-row" style={{ ...(vente ? SD_GRID_VENTE : SD_GRID), padding: '0 6px', background: '#f4f6fa', fontWeight: 500 }}>
          <span style={CELL_CTR}>{!readOnly && <DragHandle lineId={line.id} dragCtx={dragCtx} crossPanel={{ kind: 'ouvrage', id: line.id, code: line.code ?? '', label: line.designation, unit: line.unit, sourceOuvrageId: line.source_ouvrage_id }} />}</span>
          <span style={CELL_CTR}>{!vente && <TypeBadge type="ouvrage" />}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line.numero ?? ''}</span>
            {!readOnly && !vente && <NumBox line={line} onChange={(v) => updateLine.mutate({ id: line.id, patch: { numCustom: v } })} />}
          </span>
          <input data-cell="ouvrage:designation" onKeyDown={focusNextCell} key={line.designation} defaultValue={line.designation} disabled={readOnly} title={line.designation} style={{ width: '100%', minWidth: 0, fontWeight: 600 }}
            onBlur={(e) => e.target.value !== line.designation && updateLine.mutate({ id: line.id, patch: { designation: e.target.value } })} />
          <UnitSelect value={line.unit} token={token} readOnly={readOnly} style={{ width: '100%' }}
            onChange={(v) => updateLine.mutate({ id: line.id, patch: { unit: v || null } })} />
          <span />{/* Perte */}
          <input data-cell="ouvrage:quantity" onKeyDown={focusNextCell} key={cleanNum(line.quantity)} defaultValue={cleanNum(line.quantity)} disabled={readOnly} title="Quantité" style={{ width: '100%', textAlign: 'right' }}
            onBlur={(e) => e.target.value !== cleanNum(line.quantity) && updateLine.mutate({ id: line.id, patch: { quantity: e.target.value || '0' } })} />
          <span />{/* Cadence */}
          <span />{/* P.U. Public */}
          {vente
            ? <PvCell computed={puVente} forced={!!info?.forced} pending={setLinePv.isPending} decimals={decimals}
                onForce={(v) => setLinePv.mutate({ lineId: line.id, puVente: v, force: true })}
                onRelease={() => setLinePv.mutate({ lineId: line.id, puVente: null, force: false })} />
            : <span style={{ width: '100%', justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums', color: '#64748b', fontSize: 12, paddingRight: 4 }}>{(Number(line.quantity) || 0) > 0 ? fmtEuro(valueOf(line) / (Number(line.quantity) || 1), decimals) : ''}</span>}
          <span style={{ width: '100%', justifyContent: 'flex-end', fontWeight: 700, fontVariantNumeric: 'tabular-nums', paddingRight: 4 }}>{fmtV(valueOf(line))}</span>
          <span className={vente ? 'sd-actions-col' : 'sd-actions'} style={vente ? undefined : { background: 'linear-gradient(90deg, transparent, #f4f6fa 38%, #f4f6fa)' }}>
            <button type="button" className="btn-ghost" title="Informations / modifier" onClick={() => onShowInfo(line)} style={infoBtn}>ⓘ</button>
            {!readOnly && (
              <>
                {!vente && <OuvrageAddMenu parentId={line.id} childCount={comps.length} addLine={addLine} />}
                {!vente && <FraisMenu line={line} updateLine={updateLine} color="#94a3b8" />}
                <button title="Copier / Déplacer" onClick={() => onCopyMove(line)} style={{ ...togBtn(false, '#94a3b8'), fontSize: 13 }}>⧉</button>
                <button title="Variante" onClick={() => setSection.mutate({ id: line.id, sectionType: ouvrSect === 'variante' ? null : 'variante' })} style={togBtn(ouvrSect === 'variante', '#f97316')}>V</button>
                <button title="Option" onClick={() => setSection.mutate({ id: line.id, sectionType: ouvrSect === 'option' ? null : 'option' })} style={togBtn(ouvrSect === 'option', '#a855f7')}>O</button>
                <button className="btn-ghost" title="Supprimer" onClick={() => deleteLine.mutate(line.id)}>✕</button>
              </>
            )}
          </span>
        </div>
        {/* Sous-détail éditable — colonnes alignées (en-tête unique en haut du corps). */}
        {!vente && comps.map((c) => {
          const cQty = Number(c.quantity) || 0;
          const cPerte = Number(c.perte) || 0;
          const isSubOuvrage = c.type === 'ouvrage';
          const subDebours = isSubOuvrage ? Number(deboursById.get(c.id) ?? 0) : 0;
          const subUnitPu = isSubOuvrage && cQty > 0 ? subDebours / cQty : 0;
          const cPu = isSubOuvrage ? subUnitPu : (Number(c.pu) || 0);
          const montant = cQty * cPu * (1 + cPerte / 100);
          const showConv = !isSubOuvrage && c.prix_public != null && c.prix_public !== '' && Number(c.prix_public) !== (Number(c.pu) || 0);
          return (
            <Fragment key={c.id}>
              <DropZone beforeLineId={c.id} parentLineId={line.id} dragCtx={dragCtx} />
              <div className="sd-row" style={{ ...SD_GRID, padding: '0 6px', fontSize: 12, color: '#475569', opacity: dragCtx.dragLineId === c.id ? 0.4 : 1 }}>
                <span style={CELL_CTR}>{!readOnly && <DragHandle lineId={c.id} dragCtx={dragCtx} />}</span>
                <span style={CELL_CTR}><TypeBadge type={c.type} /></span>
                {!isSubOuvrage
                  ? <CodeInput value={c.code_analytique} readOnly={readOnly} placeholder="Analy." title="Code analytique" style={{ width: '100%' }}
                      onChange={(v) => updateLine.mutate({ id: c.id, patch: { codeAnalytique: v } })} />
                  : <span />}
                <input data-cell="ressource:designation" onKeyDown={focusNextCell} key={c.designation} defaultValue={c.designation} disabled={readOnly} title={c.designation} style={{ width: '100%', minWidth: 0 }}
                  onBlur={(e) => e.target.value !== c.designation && updateLine.mutate({ id: c.id, patch: { designation: e.target.value, syncByCode: true } })} />
                <UnitSelect value={c.unit} token={token} readOnly={readOnly} style={{ width: '100%' }}
                  onChange={(v) => updateLine.mutate({ id: c.id, patch: { unit: v || null } })} />
                {!isSubOuvrage
                  ? <input data-cell="ressource:perte" onKeyDown={focusNextCell} key={cleanNum(c.perte ?? '0')} defaultValue={cleanNum(c.perte ?? '0')} disabled={readOnly} title="Perte %" style={{ width: '100%', textAlign: 'right' }}
                      onBlur={(e) => e.target.value !== cleanNum(c.perte ?? '0') && updateLine.mutate({ id: c.id, patch: { perte: e.target.value || '0', syncByCode: true } })} />
                  : <span />}
                <input data-cell="ressource:quantity" onKeyDown={focusNextCell} key={cleanNum(c.quantity)} defaultValue={cleanNum(c.quantity)} disabled={readOnly} title="Ratio / quantité" style={{ width: '100%', textAlign: 'right' }}
                  onBlur={(e) => e.target.value !== cleanNum(c.quantity) && updateLine.mutate({ id: c.id, patch: { quantity: e.target.value || '0' } })} />
                {!isSubOuvrage
                  ? <input data-cell="ressource:cadence" onKeyDown={focusNextCell} key={cleanNum(c.cadence ?? '')} defaultValue={cleanNum(c.cadence ?? '')} disabled={readOnly} title="Cadence (rendement) — MO : quantité = 1/cadence" placeholder="—" style={{ width: '100%', textAlign: 'right' }}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v === cleanNum(c.cadence ?? '')) return;
                        const cad = Number(v.replace(',', '.'));
                        if (v && cad > 0) updateLine.mutate({ id: c.id, patch: { cadence: v, quantity: (1 / cad).toFixed(6) } });
                        else updateLine.mutate({ id: c.id, patch: { cadence: null } });
                      }} />
                  : <span />}
                {!isSubOuvrage
                  ? <span style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2, minWidth: 0 }}>
                      <input data-cell="ressource:prix_public" onKeyDown={focusNextCell} key={cleanNum(c.prix_public ?? '')} defaultValue={cleanNum(c.prix_public ?? '')} disabled={readOnly} title="P.U. Public (catalogue)" placeholder="—" style={{ width: '100%', textAlign: 'right', minWidth: 0 }}
                        onBlur={(e) => e.target.value !== cleanNum(c.prix_public ?? '') && updateLine.mutate({ id: c.id, patch: { prixPublic: e.target.value || null, syncByCode: true } })} />
                      {showConv && <span title="Déboursé déduit du prix public via le coefficient de conversion" style={{ fontSize: 8, color: 'var(--accent)', fontWeight: 700 }}>conv</span>}
                    </span>
                  : <span />}
                {isSubOuvrage
                  ? <span style={{ width: '100%', justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums', color: '#64748b', fontSize: 12, paddingRight: 4 }}>{fmtEuro(subUnitPu, decimals)}</span>
                  : <input data-cell="ressource:pu" onKeyDown={focusNextCell} key={cleanNum(c.pu)} defaultValue={cleanNum(c.pu)} disabled={readOnly} title="P.U. déboursé" style={{ width: '100%', textAlign: 'right' }}
                      onBlur={(e) => e.target.value !== cleanNum(c.pu) && updateLine.mutate({ id: c.id, patch: { pu: e.target.value || '0', syncByCode: true } })} />}
                <span style={{ width: '100%', justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums', color: '#334155', fontWeight: 500, paddingRight: 4 }}>{fmtEuro(montant, decimals)}</span>
                <span className="sd-actions" style={{ background: 'linear-gradient(90deg, transparent, #f8fafc 38%, #f8fafc)' }}>
                  <button type="button" className="btn-ghost" title="Modifier la ressource (nature, code, prix…)" onClick={() => onShowInfo(c)} style={infoBtn}>ⓘ</button>
                  {!readOnly && (
                    <>
                      <button title="Copier / Déplacer" onClick={() => onCopyMove(c)} style={{ ...togBtn(false, '#94a3b8'), fontSize: 13 }}>⧉</button>
                      <button className="btn-ghost" title="Supprimer" onClick={() => deleteLine.mutate(c.id)}>✕</button>
                    </>
                  )}
                </span>
              </div>
            </Fragment>
          );
        })}
        {!vente && <DropZone beforeLineId={null} parentLineId={line.id} dragCtx={dragCtx} />}
        {/* Synthèse par ouvrage : répartition du déboursé Travaux directs / Sous-traitance. */}
        {!vente && comps.length > 0 && natureById?.get(line.id) && (() => {
          const nb = natureById.get(line.id)!;
          const directs = Number(nb.labor) + Number(nb.material) + Number(nb.equipment);
          const st = Number(nb.subcontract);
          if (directs === 0 && st === 0) return null;
          return (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, padding: '1px 10px 3px', fontSize: 10, color: '#94a3b8' }}>
              <span>Travaux directs <b style={{ color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{fmtEuro(directs, decimals)}</b></span>
              {st > 0 && <span>Sous-traitance <b style={{ color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{fmtEuro(st, decimals)}</b></span>}
            </div>
          );
        })()}
      </div>
    );
  }

  if (line.type === 'ressource') {
    const info = saleById?.get(line.id);
    const qtyN = Number(line.quantity) || 0;
    const puVente = vente && info && qtyN ? Number(info.pv) / qtyN : null;
    return (
      <div style={{ marginLeft: pad, display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', fontSize: 13, opacity: isDragging ? 0.4 : 1 }}>
        {!readOnly && <DragHandle lineId={line.id} dragCtx={dragCtx} />}
        {!vente && (
          <>
            <TypeBadge type="ressource" />
            <CodeInput value={line.code} readOnly={readOnly} placeholder="Code" title="Code produit" style={{ width: 80 }}
              onChange={(v) => updateLine.mutate({ id: line.id, patch: { code: v } })} />
            <CodeInput value={line.code_analytique} readOnly={readOnly} placeholder="Analytique" title="Code analytique" style={{ width: 80 }}
              onChange={(v) => updateLine.mutate({ id: line.id, patch: { codeAnalytique: v } })} />
          </>
        )}
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.numero ?? ''}</span>
        {!readOnly && <NumBox line={line} onChange={(v) => updateLine.mutate({ id: line.id, patch: { numCustom: v } })} />}
        <input data-cell="ressource:designation" onKeyDown={focusNextCell} key={line.designation} defaultValue={line.designation} disabled={readOnly} style={{ flex: 1 }}
          onBlur={(e) => e.target.value !== line.designation && updateLine.mutate({ id: line.id, patch: { designation: e.target.value, syncByCode: !!line.code } })} />
        <button type="button" className="btn-ghost" title="Informations" onClick={() => onShowInfo(line)} style={infoBtn}>ⓘ</button>
        <input data-cell="ressource:quantity" onKeyDown={focusNextCell} key={cleanNum(line.quantity)} defaultValue={cleanNum(line.quantity)} disabled={readOnly} title="Quantité" style={{ width: 56, textAlign: 'right' }}
          onBlur={(e) => e.target.value !== cleanNum(line.quantity) && updateLine.mutate({ id: line.id, patch: { quantity: e.target.value || '0' } })} />
        <UnitSelect value={line.unit} token={token} readOnly={readOnly}
          onChange={(v) => updateLine.mutate({ id: line.id, patch: { unit: v || null } })} />
        {vente ? (
          <PvCell computed={puVente} forced={!!info?.forced} pending={setLinePv.isPending} decimals={decimals}
            onForce={(v) => setLinePv.mutate({ lineId: line.id, puVente: v, force: true })}
            onRelease={() => setLinePv.mutate({ lineId: line.id, puVente: null, force: false })} />
        ) : (
          <input data-cell="ressource:pu" onKeyDown={focusNextCell} key={cleanNum(line.pu)} defaultValue={cleanNum(line.pu)} disabled={readOnly} title="PU déboursé" style={{ width: 72, textAlign: 'right' }}
            onBlur={(e) => e.target.value !== cleanNum(line.pu) && updateLine.mutate({ id: line.id, patch: { pu: e.target.value || '0', syncByCode: !!line.code } })} />
        )}
        <span style={{ width: 80, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtV(valueOf(line))}</span>
        {!readOnly && (
          <>
            <button title="Copier / Déplacer" onClick={() => onCopyMove(line)} style={{ ...togBtn(false, '#94a3b8'), fontSize: 13 }}>⧉</button>
            <button className="btn-ghost" title="Supprimer" onClick={() => deleteLine.mutate(line.id)}>✕</button>
          </>
        )}
      </div>
    );
  }

  // texte libre
  return (
    <div style={{ marginLeft: pad, padding: '3px 8px', fontStyle: 'italic', color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, opacity: isDragging ? 0.4 : 1 }}>
      {!readOnly && <DragHandle lineId={line.id} dragCtx={dragCtx} />}
      {!vente && <TypeBadge type="texte" />}
      <input defaultValue={line.designation} disabled={readOnly} style={{ flex: 1, fontStyle: 'italic' }}
        onBlur={(e) => e.target.value !== line.designation && updateLine.mutate({ id: line.id, patch: { designation: e.target.value } })} />
      {!readOnly && <button className="btn-ghost" title="Supprimer" onClick={() => deleteLine.mutate(line.id)}>✕</button>}
    </div>
  );
}

/** Whether a drag event carries a library item (not an internal reorder). */
function acceptDrop(e: React.DragEvent) {
  return e.dataTransfer.types.includes('application/json');
}

/** Menu « + » : le déroulant est rendu en portail (document.body, position fixe calculée sur le
 * bouton) pour échapper à l'opacité/au rognage du bandeau d'actions flottant. Il reste donc
 * toujours visible et cliquable, même quand le curseur quitte la ligne. */
function AddMenu({ triggerStyle, triggerTitle, triggerLabel = '+', children }: {
  triggerStyle: React.CSSProperties;
  triggerTitle: string;
  triggerLabel?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 132) });
    setOpen(true);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <button ref={btnRef} type="button" title={triggerTitle} onClick={toggle} style={triggerStyle}>{triggerLabel}</button>
      {open && pos && createPortal(
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 3000 }} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 3001, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.18)', padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'center' }}>
            {children(close)}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}

/**
 * Marque une ligne comme FRAIS (non vendable) et choisit l'assiette de ventilation :
 * part propre (MO/matériaux/matériel), sous-traitance, ou tout le déboursé.
 * Une ligne vendable normale reste le cas par défaut.
 */
function FraisMenu({ line, updateLine, color }: {
  line: MontageLine; color: string;
} & Pick<Muts, 'updateLine'>) {
  const isFrais = line.vendable === false;
  const base = line.ventilation_base ?? 'all';
  const label = !isFrais ? 'F' : base === 'propre' ? 'FP' : base === 'st' ? 'FS' : 'F*';
  const choices: { v: 'propre' | 'st' | 'all'; l: string; t: string }[] = [
    { v: 'propre', l: 'FP', t: 'Frais ventilés sur la part propre (MO / matériaux / matériel)' },
    { v: 'st', l: 'FS', t: 'Frais ventilés sur la sous-traitance' },
    { v: 'all', l: 'F*', t: 'Frais ventilés sur tout le déboursé' },
  ];
  return (
    <AddMenu
      triggerLabel={label}
      triggerTitle={isFrais ? `Ligne de frais — ventilation : ${base}` : 'Marquer comme ligne de frais (ventilée)'}
      triggerStyle={{
        width: 24, height: 20, borderRadius: 4,
        border: `1px solid ${isFrais ? '#0ea5e9' : color}`,
        background: isFrais ? '#0ea5e9' : 'transparent',
        color: isFrais ? '#fff' : color,
        fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0,
      }}>
      {(close) => (
        <>
          {choices.map((c) => (
            <ActionSquare key={c.v} label={c.l} title={c.t}
              color={isFrais && base === c.v ? '#0ea5e9' : '#64748b'}
              onClick={() => { updateLine.mutate({ id: line.id, patch: { vendable: false, ventilationBase: c.v } }); close(); }} />
          ))}
          <ActionSquare label="€" title="Ligne vendable (annuler « frais »)" color="#16a34a"
            onClick={() => { updateLine.mutate({ id: line.id, patch: { vendable: true, ventilationBase: null } }); close(); }} />
        </>
      )}
    </AddMenu>
  );
}

function SectionActions({ parentId, childCount, depth, addLine, headerColor }: {
  parentId: string; childCount: number; depth: number; headerColor: string;
} & Pick<Muts, 'addLine'>) {
  return (
    <AddMenu triggerTitle="Ajouter un élément dans cette section"
      triggerStyle={{ width: 20, height: 20, borderRadius: 4, border: `1px solid ${headerColor}`, background: 'transparent', color: headerColor, fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, opacity: 0.8, flexShrink: 0 }}>
      {(close) => (
        <>
          <ActionSquare label="O" title="Ajouter un ouvrage libre" color="var(--primary)"
            onClick={() => { addLine.mutate({ type: 'ouvrage', parentLineId: parentId, designation: 'Nouvel ouvrage', quantity: '1', sortOrder: childCount }); close(); }} />
          <ActionSquare label="T" title="Ajouter un texte libre" color="#d97706"
            onClick={() => { addLine.mutate({ type: 'texte', parentLineId: parentId, designation: 'Texte libre', sortOrder: childCount }); close(); }} />
          <ActionSquare label="S" title={`Ajouter un sous-niveau ${depth + 2}`} color="#64748b"
            onClick={() => { addLine.mutate({ type: 'sous_titre', parentLineId: parentId, designation: 'Sous-titre', sortOrder: childCount }); close(); }} />
        </>
      )}
    </AddMenu>
  );
}

function UnitSelect({ value, token, readOnly, onChange, style }: {
  value: string | null | undefined;
  token: string | null;
  readOnly: boolean;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
}) {
  const { data } = useQuery({
    queryKey: ['params-units'],
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
    queryFn: () => apiFetch<{ id: string; abrev: string; label: string }[]>('/params/units', { token }),
  });
  const units: { id: string; abrev: string; label: string }[] = data ?? [];
  const current = value ?? '';
  const knownAbrevs = new Set(units.map((u) => u.abrev));
  return (
    <select
      value={current}
      disabled={readOnly}
      title="Unité"
      onChange={(e) => onChange(e.target.value)}
      style={{ width: 60, fontSize: 12, padding: '1px 2px', border: '1px solid #e2e8f0', borderRadius: 4, background: '#f8fafc', color: '#475569', textAlign: 'center', flexShrink: 0, ...style }}
    >
      <option value="">—</option>
      {current && !knownAbrevs.has(current) && <option value={current}>{current}</option>}
      {units.map((u) => (
        <option key={u.id} value={u.abrev} title={u.label}>{u.abrev}</option>
      ))}
    </select>
  );
}

function TypeBadge({ type }: { type: string }) {
  const cfg: Record<string, { label: string; color: string; bg: string }> = {
    ressource: { label: 'R', color: '#475569', bg: '#f1f5f9' },
    ouvrage:   { label: 'O', color: 'var(--primary)', bg: '#eff6ff' },
    texte:     { label: 'T', color: '#d97706', bg: '#fffbeb' },
  };
  const c = cfg[type];
  if (!c) return null;
  return (
    <span title={`Type : ${type}`} style={{
      width: 18, height: 18, borderRadius: 3, background: c.bg, color: c.color,
      fontSize: 9, fontWeight: 700, flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: `1px solid ${c.color}`, lineHeight: 1, userSelect: 'none',
    }}>{c.label}</span>
  );
}

/** Nature d'une ressource (MO/matériaux/matériel/ST) — pilote la ventilation des tableaux de bord.
 * Vide pour une ressource manuelle non classée : à défaut, le calcul retombe sur « Matériaux ». */
const NATURE_CHOICES: { value: string; label: string; short: string }[] = [
  { value: 'material', label: 'Matériaux', short: 'MAT' },
  { value: 'labor', label: "Main d'œuvre", short: 'MO' },
  { value: 'equipment', label: 'Matériel', short: 'MATL' },
  { value: 'subcontract', label: 'Sous-traitance', short: 'ST' },
];
function NatureSelect({ value, readOnly, onChange, style }: {
  value: string | null | undefined;
  readOnly: boolean;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
}) {
  const current = value ?? '';
  return (
    <select
      value={current}
      disabled={readOnly}
      title="Nature (ventilation MO / matériaux / matériel / sous-traitance)"
      onChange={(e) => onChange(e.target.value)}
      style={{ width: 62, fontSize: 12, padding: '1px 2px', border: `1px solid ${current ? '#e2e8f0' : '#f59e0b'}`, borderRadius: 4, background: current ? '#f8fafc' : '#fffbeb', color: '#475569', textAlign: 'center', flexShrink: 0, ...style }}
    >
      <option value="">—</option>
      {NATURE_CHOICES.map((n) => (
        <option key={n.value} value={n.value} title={n.label}>{n.short}</option>
      ))}
    </select>
  );
}

/** Distributeur de la ligne (référentiel Fournisseurs) — indépendant de la bibliothèque. */
function SupplierSelect({ value, token, readOnly, onChange }: {
  value: string; token: string | null; readOnly: boolean; onChange: (v: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ['suppliers-all'], enabled: Boolean(token), staleTime: 5 * 60_000,
    queryFn: () => apiFetch<{ rows: { id: string; code: string; name: string }[] }>('/suppliers?pageSize=300', { token }),
  });
  return (
    <select value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 13, background: readOnly ? '#f8fafc' : '#fff' }}>
      <option value="">— aucun —</option>
      {(data?.rows ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

/**
 * Type de déboursé de la ligne : référentiel société + types propres à ce devis. Choisir un type
 * fixe aussi la nature de rattachement, celle que lisent les budgets de chantier et l'analytique.
 */
interface DebTypeOpt { id: string; code: string; label: string; baseNature: string }
function DebourseTypeSelect({ value, versionId, token, readOnly, onChange }: {
  value: string; versionId: string; token: string | null; readOnly: boolean;
  onChange: (id: string, baseNature: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ['debourse-types', versionId], enabled: Boolean(token && versionId), staleTime: 60_000,
    queryFn: () => apiFetch<DebTypeOpt[]>(`/debourse-types?devisVersionId=${versionId}`, { token }),
  });
  const types = data ?? [];
  return (
    <select value={value} disabled={readOnly} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 13, background: readOnly ? '#f8fafc' : '#fff' }}
      onChange={(e) => {
        const t = types.find((x) => x.id === e.target.value);
        onChange(e.target.value, t?.baseNature ?? '');
      }}>
      <option value="">— aucun (taux de la nature) —</option>
      {types.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.label}</option>)}
    </select>
  );
}

/** Types de sous-traitance déclarés sur CE devis (onglet « Coefficients & frais »). */
interface StType { id: string; code?: string | null; label: string }
function StTypeSelect({ value, versionId, token, readOnly, onChange }: {
  value: string; versionId: string; token: string | null; readOnly: boolean;
  onChange: (v: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ['sale-config', versionId], enabled: Boolean(token && versionId), retry: false,
    queryFn: () => apiFetch<{ stTypes?: StType[] }>(`/versions/${versionId}/sale-sheet/config`, { token }),
  });
  const types = data?.stTypes ?? [];
  return (
    <>
      <select value={value} disabled={readOnly || types.length === 0} onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 13, background: readOnly ? '#f8fafc' : '#fff' }}>
        <option value="">— taux de la nature —</option>
        {types.map((t) => <option key={t.id} value={t.id}>{t.code ? `${t.code} — ` : ''}{t.label}</option>)}
      </select>
      {types.length === 0 && (
        <span className="muted" style={{ fontSize: 10 }}>
          Aucun type défini — onglet « Coefficients &amp; frais ».
        </span>
      )}
    </>
  );
}

interface ParamCode { id: string; code: string; label: string; famille_id: string }
interface ParamFamille { id: string; code: string; label: string }

/**
 * Code analytique — liste déroulante alimentée par les Paramètres société. La saisie clavier est
 * autorisée (datalist), mais la valeur doit exister dans la liste : si le code saisi est inconnu,
 * on propose de le CRÉER et de l'ajouter au référentiel (POST /params/codes), sinon la saisie est
 * annulée. Garantit que l'axe analytique reste une référence partagée et cohérente.
 */
function CodeAnalytiqueField({ value, token, readOnly, onChange }: {
  value: string; token: string | null; readOnly: boolean;
  onChange: (code: string) => void;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const codes = useQuery({
    queryKey: ['params-codes'], enabled: Boolean(token), staleTime: 5 * 60_000,
    queryFn: () => apiFetch<ParamCode[]>('/params/codes', { token }),
  });
  const familles = useQuery({
    queryKey: ['params-familles'], enabled: Boolean(token), staleTime: 5 * 60_000,
    queryFn: () => apiFetch<ParamFamille[]>('/params/familles', { token }),
  });
  const createCode = useMutation({
    mutationFn: (body: { familleId: string; code: string; label: string }) =>
      apiFetch('/params/codes', { method: 'POST', body, token }),
    onSuccess: (_r, body) => {
      qc.invalidateQueries({ queryKey: ['params-codes'] });
      onChange(body.code);
      setPending(null);
    },
  });

  const list = codes.data ?? [];
  const known = (c: string) => list.some((x) => x.code.toLowerCase() === c.toLowerCase());

  // Combobox maison : le <datalist> natif tronque la liste et ne se fait pas défiler.
  // Ici : panneau en portail, défilement complet, filtrage sur code ET libellé, clavier.
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const place = () => {
    const r = boxRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 260) });
  };
  const openList = () => { place(); setHi(0); setOpen(true); };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? list.filter((c) => c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q))
    : list;

  const pick = (c: ParamCode) => { setQuery(c.code); setOpen(false); if (c.code !== value) onChange(c.code); };

  const commit = (raw: string) => {
    const v = raw.trim();
    setOpen(false);
    if (v === (value ?? '')) return;
    if (!v) { onChange(''); return; }
    const hit = list.find((x) => x.code.toLowerCase() === v.toLowerCase());
    if (hit) { onChange(hit.code); return; }
    setPending(v); // inconnu → proposer la création
  };

  return (
    <>
      <input ref={boxRef} value={query} disabled={readOnly}
        placeholder={list.length ? 'Choisir ou saisir…' : '—'}
        style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 13, fontFamily: 'monospace', background: readOnly ? '#f8fafc' : '#fff' }}
        onChange={(e) => { setQuery(e.target.value); setHi(0); if (!open) openList(); else place(); }}
        onFocus={openList}
        onBlur={(e) => { setTimeout(() => commit(e.target.value), 120); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) openList(); else setHi((i) => Math.min(i + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && filtered[hi]) pick(filtered[hi]);
            else commit(e.currentTarget.value);
          } else if (e.key === 'Escape') { setOpen(false); setQuery(value); }
        }} />
      {open && pos && filtered.length > 0 && createPortal(
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: 280, overflowY: 'auto', zIndex: 1200, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 10px 30px rgba(15,23,42,0.18)' }}
          onMouseDown={(e) => e.preventDefault() /* garde le focus : le blur ne doit pas annuler le clic */}>
          {filtered.map((c, i) => (
            <div key={c.id} onClick={() => pick(c)} onMouseEnter={() => setHi(i)}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 10px', cursor: 'pointer', fontSize: 12, background: i === hi ? '#eef2f7' : undefined }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--primary)' }}>{c.code}</span>
              <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
      {value && !known(value) && list.length > 0 && (
        <span style={{ fontSize: 10, color: '#b45309' }}>Code hors référentiel</span>
      )}
      {pending && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}
          onClick={() => setPending(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 96vw)' }}>
            <h3 style={{ marginTop: 0 }}>Code analytique inconnu</h3>
            <p className="muted" style={{ marginTop: 4 }}>
              Le code <strong style={{ fontFamily: 'monospace' }}>{pending}</strong> ne figure pas dans les
              paramètres société. Voulez-vous le créer et l&apos;ajouter à la liste ?
            </p>
            <CreateCodeForm
              code={pending}
              familles={familles.data ?? []}
              pending={createCode.isPending}
              onCancel={() => setPending(null)}
              onCreate={(familleId, label) => createCode.mutate({ familleId, code: pending, label })}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function CreateCodeForm({ code, familles, pending, onCancel, onCreate }: {
  code: string; familles: ParamFamille[]; pending: boolean;
  onCancel: () => void; onCreate: (familleId: string, label: string) => void;
}) {
  const [familleId, setFamilleId] = useState(familles[0]?.id ?? '');
  const [label, setLabel] = useState(code);
  const inputStyle: React.CSSProperties = { width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 13 };
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>
          Famille
          <select value={familleId} onChange={(e) => setFamilleId(e.target.value)} style={{ ...inputStyle, marginTop: 3 }}>
            {familles.length === 0 && <option value="">— aucune famille paramétrée —</option>}
            {familles.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>
          Libellé
          <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ ...inputStyle, marginTop: 3 }} />
        </label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button className="btn-secondary" onClick={onCancel}>Annuler</button>
        <button className="btn btn-primary" disabled={!familleId || !label.trim() || pending}
          onClick={() => onCreate(familleId, label.trim())}>
          {pending ? '…' : 'Créer le code'}
        </button>
      </div>
    </>
  );
}

function CodeInput({ value, readOnly, placeholder, title, style, onChange }: {
  value: string | null | undefined; readOnly: boolean; placeholder: string;
  title: string; style?: React.CSSProperties; onChange: (v: string) => void;
}) {
  return (
    <input title={title} placeholder={placeholder} defaultValue={value ?? ''} disabled={readOnly}
      onBlur={(e) => { const next = e.target.value.trim(); if (next !== (value ?? '')) onChange(next); }}
      style={{ fontSize: 11, fontFamily: 'monospace', color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 4px', ...style }} />
  );
}

function OuvrageAddMenu({ parentId, childCount, addLine }: {
  parentId: string; childCount: number;
} & Pick<Muts, 'addLine'>) {
  return (
    <AddMenu triggerTitle="Ajouter un élément dans cet ouvrage"
      triggerStyle={{ width: 20, height: 20, borderRadius: 4, border: '1px dashed #94a3b8', background: 'transparent', color: '#64748b', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0 }}>
      {(close) => (
        <>
          <ActionSquare label="R" title="Ajouter une ressource" color="#64748b"
            onClick={() => { addLine.mutate({ type: 'ressource', parentLineId: parentId, designation: 'Nouvelle ressource', quantity: '1', pu: '0', sortOrder: childCount }); close(); }} />
          <ActionSquare label="O" title="Ajouter un sous-ouvrage" color="var(--primary)"
            onClick={() => { addLine.mutate({ type: 'ouvrage', parentLineId: parentId, designation: 'Sous-ouvrage', quantity: '1', sortOrder: childCount }); close(); }} />
        </>
      )}
    </AddMenu>
  );
}

function ActionSquare({ label, title, color, onClick }: { label: string; title: string; color: string; onClick: () => void }) {
  return (
    <button type="button" title={title} onClick={onClick}
      style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${color}`, background: 'transparent', color, fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0 }}>
      {label}
    </button>
  );
}

const infoBtn: React.CSSProperties = { color: 'var(--primary)', fontSize: 14, padding: '0 4px', lineHeight: 1, flexShrink: 0 };

function NumBox({ line, onChange }: { line: MontageLine; onChange: (v: string) => void }) {
  return (
    <input title="N° personnalisé" placeholder={line.numero ?? 'N°'} defaultValue={line.num_custom ?? ''}
      onBlur={(e) => (e.target.value || '') !== (line.num_custom ?? '') && onChange(e.target.value)}
      style={{ width: 40, fontSize: 11, fontFamily: 'monospace', textAlign: 'center', background: '#fff', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--primary)', padding: '2px 4px', flexShrink: 0 }} />
  );
}

/** Fiche de modification d'une ligne de devis — même formulaire que la fiche ressource de la
 * bibliothèque, mais les modifications ne touchent QUE cette ligne du devis (via updateLine),
 * jamais la ressource de la bibliothèque société. La nature s'édite ici (plus de colonne). */
function LineInfoModal({ line, components, deboursById, decimals, token, versionId, readOnly, updateLine, onClose }: {
  line: MontageLine; components: MontageLine[];
  deboursById: Map<string, string>; decimals: number;
  token: string | null; versionId: string; readOnly: boolean;
  updateLine: Muts['updateLine'];
  onClose: () => void;
}) {
  const isOuvrage = line.type === 'ouvrage';
  const debours = Number(deboursById.get(line.id) ?? 0);
  const hasCode = !!line.code;

  // État local du formulaire : feedback immédiat + persistance à la validation de chaque champ.
  const [form, setForm] = useState({
    code: line.code ?? '',
    codeAnalytique: line.code_analytique ?? '',
    designation: line.designation ?? '',
    unit: line.unit ?? '',
    nature: line.nature ?? '',
    quantity: cleanNum(line.quantity),
    perte: cleanNum(line.perte ?? '0'),
    cadence: cleanNum(line.cadence ?? ''),
    pu: cleanNum(line.pu),
    prixPublic: cleanNum(line.prix_public ?? ''),
    stTypeId: line.st_type_id ?? '',
    debourseTypeId: line.debourse_type_id ?? '',
    uniteAchat: line.unite_achat ?? '',
    coeffConversion: cleanNum(line.coeff_conversion ?? '') || '1',
    supplierId: line.supplier_id ?? '',
    refFournisseur: line.ref_fournisseur ?? '',
    conditionnement: line.conditionnement ?? '',
  });
  type FormKey = keyof typeof form;
  const set = (k: FormKey, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Commit d'un champ : n'écrit que si la valeur a changé ; syncByCode propage aux lignes de même
  // code dans ce devis (comme l'édition inline), sans jamais toucher la bibliothèque.
  const commit = (patch: Record<string, unknown>, sync = false) => {
    if (readOnly) return;
    updateLine.mutate({ id: line.id, patch: sync && hasCode ? { ...patch, syncByCode: true } : patch });
  };

  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 3, display: 'block' };
  const inputStyle: React.CSSProperties = { width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 13, background: readOnly ? '#f8fafc' : '#fff' };
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ flex: 1, minWidth: 0 }}><span style={labelStyle}>{label}</span>{children}</div>
  );

  // Portail vers <body> : le panneau du devis a un contexte de transformation qui confinerait un
  // overlay position:fixed ; le portail garantit un centrage plein écran.
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px, 96vw)', maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{isOuvrage ? 'Ouvrage' : 'Ressource'} — {readOnly ? 'informations' : 'modifier'}</h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <p className="muted" style={{ marginTop: 2 }}>
          {line.numero ? <>N° <span style={{ fontFamily: 'monospace' }}>{line.numero}</span> — </> : null}
          Modifie uniquement cette ligne du devis, sans incidence sur la bibliothèque société.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {!isOuvrage && (
            <div style={{ display: 'flex', gap: 12 }}>
              <Field label="Code produit">
                <input defaultValue={form.code} disabled={readOnly} style={{ ...inputStyle, fontFamily: 'monospace' }}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (line.code ?? '')) { set('code', v); commit({ code: v || null }); } }} />
              </Field>
              <Field label="Code analytique">
                <CodeAnalytiqueField value={form.codeAnalytique} token={token} readOnly={readOnly}
                  onChange={(v) => { set('codeAnalytique', v); commit({ codeAnalytique: v || null }); }} />
              </Field>
            </div>
          )}

          <Field label="Désignation">
            <input defaultValue={form.designation} disabled={readOnly} style={inputStyle}
              onBlur={(e) => { const v = e.target.value; if (v !== line.designation) { set('designation', v); commit({ designation: v }, true); } }} />
          </Field>

          <div style={{ display: 'flex', gap: 12 }}>
            <Field label={isOuvrage ? 'Unité' : "Unité d'emploi"}>
              <UnitSelect value={form.unit} token={token} readOnly={readOnly} style={{ width: '100%', textAlign: 'left' }}
                onChange={(v) => { set('unit', v); commit({ unit: v || null }); }} />
            </Field>
            {!isOuvrage && (
              <Field label="Nature">
                <NatureSelect value={form.nature} readOnly={readOnly} style={{ width: '100%', textAlign: 'left' }}
                  onChange={(v) => { set('nature', v); commit({ nature: v || null }, true); }} />
              </Field>
            )}
          </div>

          {!isOuvrage && (
            <Field label="Type de déboursé">
              <DebourseTypeSelect value={form.debourseTypeId} versionId={versionId} token={token} readOnly={readOnly}
                onChange={(id, baseNature) => {
                  setForm((f) => ({ ...f, debourseTypeId: id, nature: baseNature || f.nature }));
                  commit(
                    baseNature
                      ? { debourseTypeId: id || null, nature: baseNature }
                      : { debourseTypeId: id || null },
                    true,
                  );
                }} />
            </Field>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <Field label={isOuvrage ? 'Quantité' : 'Quantité / ratio'}>
              <input defaultValue={form.quantity} disabled={readOnly} style={{ ...inputStyle, textAlign: 'right' }}
                onBlur={(e) => { const v = e.target.value; if (v !== cleanNum(line.quantity)) { set('quantity', v); commit({ quantity: v || '0' }); } }} />
            </Field>
            {!isOuvrage && (
              <>
                <Field label="Perte %">
                  <input defaultValue={form.perte} disabled={readOnly} style={{ ...inputStyle, textAlign: 'right' }}
                    onBlur={(e) => { const v = e.target.value; if (v !== cleanNum(line.perte ?? '0')) { set('perte', v); commit({ perte: v || '0' }, true); } }} />
                </Field>
                <Field label="Cadence (rendement)">
                  <input defaultValue={form.cadence} disabled={readOnly} placeholder="—" style={{ ...inputStyle, textAlign: 'right' }}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v === cleanNum(line.cadence ?? '')) return;
                      set('cadence', v);
                      const cad = Number(v.replace(',', '.'));
                      if (v && cad > 0) commit({ cadence: v, quantity: (1 / cad).toFixed(6) });
                      else commit({ cadence: null });
                    }} />
                </Field>
              </>
            )}
          </div>

          {!isOuvrage && (
            <div style={{ display: 'flex', gap: 12 }}>
              <Field label="P.U. déboursé">
                <input defaultValue={form.pu} disabled={readOnly} style={{ ...inputStyle, textAlign: 'right' }}
                  onBlur={(e) => { const v = e.target.value; if (v !== cleanNum(line.pu)) { set('pu', v); commit({ pu: v || '0' }, true); } }} />
              </Field>
              <Field label="P.U. public (catalogue)">
                <input defaultValue={form.prixPublic} disabled={readOnly} placeholder="—" style={{ ...inputStyle, textAlign: 'right' }}
                  onBlur={(e) => { const v = e.target.value; if (v !== cleanNum(line.prix_public ?? '')) { set('prixPublic', v); commit({ prixPublic: v || null }, true); } }} />
              </Field>
            </div>
          )}

          {/* ── ACHAT & DISTRIBUTEUR (ressource uniquement) ── */}
          {!isOuvrage && (
            <>
              <div className="form-section-title" style={{ marginTop: 4 }}>Achat &amp; distributeur</div>
              <div style={{ display: 'flex', gap: 12 }}>
                <Field label="Distributeur">
                  <SupplierSelect value={form.supplierId} token={token} readOnly={readOnly}
                    onChange={(v) => { set('supplierId', v); commit({ supplierId: v || null }); }} />
                </Field>
                <Field label="Référence distributeur">
                  <input defaultValue={form.refFournisseur} disabled={readOnly} style={inputStyle}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (line.ref_fournisseur ?? '')) { set('refFournisseur', v); commit({ refFournisseur: v || null }); } }} />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <Field label="Conditionnement">
                  <input defaultValue={form.conditionnement} disabled={readOnly} placeholder="Ex: Sac 25kg, Bidon 10L…" style={inputStyle}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (line.conditionnement ?? '')) { set('conditionnement', v); commit({ conditionnement: v || null }); } }} />
                </Field>
                <Field label="Unité d'achat">
                  <UnitSelect value={form.uniteAchat} token={token} readOnly={readOnly} style={{ width: '100%', textAlign: 'left' }}
                    onChange={(v) => { set('uniteAchat', v); commit({ uniteAchat: v || null }); }} />
                </Field>
              </div>
              <Field label="Coefficient de conversion">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input defaultValue={form.coeffConversion} disabled={readOnly} inputMode="decimal"
                    style={{ ...inputStyle, width: 110, flex: 'none', textAlign: 'right' }}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (cleanNum(line.coeff_conversion ?? '') || '1')) { set('coeffConversion', v); commit({ coeffConversion: v || null }); } }} />
                  {form.uniteAchat && form.unit && Number(form.coeffConversion) > 0 && (
                    <span className="muted" style={{ fontSize: 11, fontFamily: 'monospace', background: '#f1f5f9', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', flex: 1 }}>
                      1 {form.uniteAchat} = {fmtNum(form.coeffConversion, decimals)} {form.unit} · 1 {form.unit} = {fmtNum(1 / Number(form.coeffConversion), decimals)} {form.uniteAchat}
                    </span>
                  )}
                </div>
              </Field>
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, padding: '10px 12px', background: '#f8fafc', borderRadius: 8, fontWeight: 600 }}>
          <span className="muted">Déboursé total de la ligne</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtEuro(debours, decimals)}</span>
        </div>

        {isOuvrage && components.length > 0 && (
          <>
            <div className="form-section-title" style={{ marginTop: 16 }}>Sous-détail ({components.length})</div>
            <table className="grid" style={{ marginTop: 6 }}>
              <thead><tr><th>Désignation</th><th style={{ textAlign: 'right' }}>Qté</th><th style={{ textAlign: 'right' }}>Perte</th><th style={{ textAlign: 'right' }}>PU déboursé</th></tr></thead>
              <tbody>
                {components.map((c) => (
                  <tr key={c.id}>
                    <td>{c.designation}</td>
                    <td style={{ textAlign: 'right' }}>{c.quantity != null ? cleanNum(c.quantity) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{c.perte ? `${c.perte} %` : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmtEuro(c.pu, decimals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {!readOnly && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-primary" onClick={onClose}>Terminé</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function CopyMoveModal({ source, allLines, onClose, onDuplicate, onMove }: {
  source: MontageLine; allLines: MontageLine[]; onClose: () => void;
  onDuplicate: (keepCode: boolean, destParentId: string | null) => void;
  onMove: (destParentId: string | null, clearCode: boolean) => void;
}) {
  const [action, setAction] = useState<'copy' | 'move'>('copy');
  const [keepCode, setKeepCode] = useState(true);
  const [destId, setDestId] = useState<string>('__same__');

  const subtreeIds = new Set<string>();
  const collectSubtree = (id: string) => {
    subtreeIds.add(id);
    allLines.filter((l) => l.parent_line_id === id).forEach((l) => collectSubtree(l.id));
  };
  collectSubtree(source.id);

  // Une ressource peut être copiée/déplacée dans un autre OUVRAGE (sous-détail) mais aussi
  // directement sous un TITRE / SOUS-TITRE (ressource posée au niveau du corps du devis).
  const validParentTypes: string[] =
    source.type === 'ressource' ? ['ouvrage', 'titre', 'sous_titre'] :
    source.type === 'ouvrage' ? ['titre', 'sous_titre'] :
    ['titre', 'sous_titre'];

  const buildOptions = (parentId: string | null, depth: number): { id: string | null; label: string }[] => {
    const result: { id: string | null; label: string }[] = [];
    const children = allLines
      .filter((l) => l.parent_line_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order);
    for (const l of children) {
      if (subtreeIds.has(l.id)) continue;
      if (validParentTypes.includes(l.type)) {
        result.push({ id: l.id, label: `${'  '.repeat(depth)}${l.numero ?? ''} ${l.designation}`.trim() });
      }
      result.push(...buildOptions(l.id, depth + 1));
    }
    return result;
  };
  const options = buildOptions(null, 0);
  const canRoot = validParentTypes.some((t) => t === 'titre' || t === 'sous_titre');

  const resolve = () => {
    const dest = destId === '__same__' ? source.parent_line_id : destId === '__root__' ? null : destId;
    if (action === 'copy') onDuplicate(keepCode, dest);
    else onMove(dest, !keepCode);
    onClose();
  };

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px, 96vw)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Copier / Déplacer</h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
          <strong>{source.designation}</strong>
          {source.code ? <> — <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{source.code}</span></> : null}
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['copy', 'move'] as const).map((a) => (
            <button key={a} type="button" onClick={() => setAction(a)}
              style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: action === a ? '2px solid var(--primary)' : '1px solid var(--border)', background: action === a ? '#eff6ff' : '#fff', color: action === a ? 'var(--primary)' : 'inherit', fontWeight: action === a ? 700 : 400, cursor: 'pointer' }}>
              {a === 'copy' ? 'Copier' : 'Déplacer'}
            </button>
          ))}
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#374151' }}>Code</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {([true, false] as const).map((k) => (
              <button key={String(k)} type="button" onClick={() => setKeepCode(k)}
                style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: keepCode === k ? '2px solid var(--primary)' : '1px solid var(--border)', background: keepCode === k ? '#eff6ff' : '#fff', color: keepCode === k ? 'var(--primary)' : 'inherit', fontWeight: keepCode === k ? 700 : 400, cursor: 'pointer', fontSize: 12 }}>
                {k ? 'Conserver le code' : 'Changer le code (effacer)'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#374151' }}>Destination</div>
          <select value={destId} onChange={(e) => setDestId(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13 }}>
            <option value="__same__">— Même position (dupliquer sur place) —</option>
            {canRoot && <option value="__root__">Racine (niveau titre)</option>}
            {options.map((o) => (
              <option key={String(o.id)} value={String(o.id)}>{o.label}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="btn" onClick={resolve}>{action === 'copy' ? 'Copier' : 'Déplacer'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function PvCell({ computed, forced, pending, decimals, onForce, onRelease }: {
  computed: number | null; forced: boolean; pending: boolean; decimals: number;
  onForce: (v: string) => void; onRelease: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const shown = focused ? draft : (computed != null ? fmtNum(computed, decimals) : '');
  const commit = () => {
    setFocused(false);
    const cleaned = draft.replace(',', '.').replace(/[^0-9.]/g, '');
    if (cleaned === '') return;
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return;
    if (!forced && computed != null && Math.abs(n - computed) < 1e-6) return;
    onForce(cleaned);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
      <input
        style={{ width: 84, textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...(forced ? { borderColor: 'var(--accent)', background: '#fff7ed', color: 'var(--accent)', fontWeight: 600 } : {}) }}
        value={shown} disabled={pending}
        onFocus={() => { setFocused(true); setDraft(computed != null ? String(Number(computed.toFixed(decimals))) : ''); }}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={commit}
        onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); (ev.target as HTMLInputElement).blur(); } }}
      />
      {forced && (
        <button type="button" className="btn-ghost" title="Libérer le prix forcé"
          disabled={pending} onClick={onRelease} style={{ padding: '2px 6px', color: 'var(--accent)', lineHeight: 1 }}>🔒</button>
      )}
    </span>
  );
}

function togBtn(active: boolean, color: string): React.CSSProperties {
  return { fontSize: 11, fontWeight: 700, width: 20, height: 20, borderRadius: 4, cursor: 'pointer', border: 'none', background: active ? color : '#f1f5f9', color: active ? '#fff' : '#94a3b8', flexShrink: 0 };
}
