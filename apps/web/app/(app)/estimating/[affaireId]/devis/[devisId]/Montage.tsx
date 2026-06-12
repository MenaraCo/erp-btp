'use client';

import { Fragment, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { fmtEuro, fmtNum, cleanNum } from '@/lib/preferences';

export interface SaleLineInfo { pv: string; forced: boolean }

export interface DragItem {
  kind: 'ouvrage' | 'ressource' | 'titre' | 'sous_titre';
  id: string; code: string; label: string; unit: string | null;
  debourse?: string; codeAnalytique?: string | null;
  sourceOuvrageId?: string | null;
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
  section_type: 'option' | 'variante' | null;
  source_ouvrage_id: string | null;
  sort_order: number;
  numero?: string | null;
  num_custom?: string | null;
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
  versionId, token, lines, deboursById, onChanged, readOnly,
  mode = 'debours', saleById, decimals = 2, acceptDrop = false,
}: {
  versionId: string; token: string | null; lines: MontageLine[];
  deboursById: Map<string, string>; onChanged: () => void; readOnly: boolean;
  mode?: 'debours' | 'vente'; saleById?: Map<string, SaleLineInfo>;
  decimals?: number; acceptDrop?: boolean;
}) {
  const vente = mode === 'vente';
  const childrenOf = (pid: string | null) =>
    lines.filter((l) => l.parent_line_id === pid).sort((a, b) => a.sort_order - b.sort_order);

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
      if (item.sourceOuvrageId) {
        insertOuvrage.mutate({ ouvrageId: item.sourceOuvrageId, parentLineId: parentId, quantity: '1' });
      } else {
        addLine.mutate({ type: 'ouvrage', parentLineId: parentId, designation: item.label, code: item.code, unit: item.unit ?? '', quantity: '1' });
      }
    } else if (item.kind === 'titre' || item.kind === 'sous_titre') {
      addLine.mutate({ type: item.kind, parentLineId: item.kind === 'sous_titre' ? parentId : null, designation: item.label, sortOrder: 9999 });
    } else {
      addLine.mutate({ type: 'ressource', parentLineId: parentId, designation: item.label, code: item.code, codeAnalytique: item.codeAnalytique ?? null, unit: item.unit ?? '', quantity: '1', pu: item.debourse ?? '0' });
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
            decimals={decimals} deboursById={deboursById}
            onShowInfo={setInfoLine}
            libDragActive={libDragActive} libDragOverId={libDragOverId}
            setLibDragOverId={setLibDragOverId} onDropItem={onDropItem}
            dragCtx={dragCtx} onCopyMove={setCopyMoveSource}
          />
        </Fragment>
      ))}
      <DropZone beforeLineId={null} parentLineId={null} dragCtx={dragCtx} />
      {!readOnly && (
        <button className="btn" style={{ marginTop: 8 }}
          onClick={() => addLine.mutate({ type: 'titre', designation: 'Nouveau titre', sortOrder: roots.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1 })}>
          + Titre
        </button>
      )}
      {infoLine && (
        <LineInfoModal
          line={infoLine}
          components={infoLine.type === 'ouvrage' ? childrenOf(infoLine.id) : []}
          deboursById={deboursById}
          decimals={decimals}
          onClose={() => setInfoLine(null)}
        />
      )}
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
  vente, valueOf, saleById, setLinePv, decimals, deboursById, onShowInfo,
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
  const pad = depth * 16;
  const vctx: VenteCtx = {
    vente, valueOf, saleById, setLinePv, decimals, deboursById, onShowInfo,
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
        <div className={`title-row title-row-${depth}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: ls.bg, color: ls.color, borderRadius: 5 }}>
          {!readOnly && <DragHandle lineId={line.id} dragCtx={dragCtx} crossPanel={{ kind: line.type as 'titre' | 'sous_titre', id: line.id, code: line.code ?? '', label: line.designation, unit: null }} />}
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: ls.num, minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {line.numero ?? ''}
          </span>
          {!readOnly && (
            <input title="N° personnalisé" placeholder={line.numero ?? 'N°'} defaultValue={line.num_custom ?? ''}
              onBlur={(e) => (e.target.value || '') !== (line.num_custom ?? '') && updateLine.mutate({ id: line.id, patch: { numCustom: e.target.value } })}
              style={{ width: 48, fontSize: 11, fontFamily: 'monospace', textAlign: 'center', background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, color: ls.color, padding: '2px 4px' }} />
          )}
          <input className="title-input" defaultValue={line.designation} disabled={readOnly}
            onBlur={(e) => e.target.value !== line.designation && updateLine.mutate({ id: line.id, patch: { designation: e.target.value } })}
            style={{ fontWeight: line.type === 'titre' ? 700 : 600, textTransform: line.type === 'titre' ? 'uppercase' : 'none', flex: 1, border: '1px solid transparent', background: 'transparent', color: ls.color }} />
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: ls.color }}>{fmtV(valueOf(line))}</span>
          {!readOnly && (
            <>
              <SectionActions parentId={line.id} childCount={kids.length} depth={depth} vente={vente} addLine={addLine} headerColor={ls.color} />
              <button title="Copier / Déplacer" onClick={() => onCopyMove(line)} style={{ ...togBtn(false, 'rgba(255,255,255,0.5)'), fontSize: 13 }}>⧉</button>
              <button title="Variante" onClick={() => setSection.mutate({ id: line.id, sectionType: sect === 'variante' ? null : 'variante' })} style={togBtn(sect === 'variante', '#f97316')}>V</button>
              <button title="Option" onClick={() => setSection.mutate({ id: line.id, sectionType: sect === 'option' ? null : 'option' })} style={togBtn(sect === 'option', '#a855f7')}>O</button>
              <button title="Supprimer" className="btn-ghost" onClick={() => deleteLine.mutate(line.id)} style={{ color: ls.color }}>✕</button>
            </>
          )}
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
    const puDebours = qtyN ? subtree(line) / qtyN : null;
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>
          {!readOnly && <DragHandle lineId={line.id} dragCtx={dragCtx} crossPanel={{ kind: 'ouvrage', id: line.id, code: line.code ?? '', label: line.designation, unit: line.unit, sourceOuvrageId: line.source_ouvrage_id }} />}
          {!vente && (
            <>
              <TypeBadge type="ouvrage" />
              <CodeInput value={line.code} readOnly={readOnly} placeholder="Code" title="Code produit" style={{ width: 64 }}
                onChange={(v) => updateLine.mutate({ id: line.id, patch: { code: v } })} />
            </>
          )}
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.numero ?? ''}</span>
          {!readOnly && <NumBox line={line} onChange={(v) => updateLine.mutate({ id: line.id, patch: { numCustom: v } })} />}
          <input defaultValue={line.designation} disabled={readOnly} title="Désignation (devis uniquement)" style={{ flex: 1, fontWeight: 500 }}
            onBlur={(e) => e.target.value !== line.designation && updateLine.mutate({ id: line.id, patch: { designation: e.target.value } })} />
          <button type="button" className="btn-ghost" title="Informations" onClick={() => onShowInfo(line)} style={infoBtn}>ⓘ</button>
          <input defaultValue={cleanNum(line.quantity)} disabled={readOnly} title="Quantité" style={{ width: 52, textAlign: 'right' }}
            onBlur={(e) => e.target.value !== cleanNum(line.quantity) && updateLine.mutate({ id: line.id, patch: { quantity: e.target.value || '0' } })} />
          <UnitSelect value={line.unit} token={token} readOnly={readOnly}
            onChange={(v) => updateLine.mutate({ id: line.id, patch: { unit: v || null } })} />
          {vente && (
            <PvCell computed={puVente} forced={!!info?.forced} pending={setLinePv.isPending} decimals={decimals}
              onForce={(v) => setLinePv.mutate({ lineId: line.id, puVente: v, force: true })}
              onRelease={() => setLinePv.mutate({ lineId: line.id, puVente: null, force: false })} />
          )}
          <span style={{ width: 80, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtV(valueOf(line))}</span>
          {!readOnly && (
            <>
              {!vente && <OuvrageAddMenu parentId={line.id} childCount={comps.length} addLine={addLine} insertOuvrage={insertOuvrage} />}
              <button title="Copier / Déplacer" onClick={() => onCopyMove(line)} style={{ ...togBtn(false, '#94a3b8'), fontSize: 13 }}>⧉</button>
              <button title="Variante" onClick={() => setSection.mutate({ id: line.id, sectionType: ouvrSect === 'variante' ? null : 'variante' })} style={togBtn(ouvrSect === 'variante', '#f97316')}>V</button>
              <button title="Option" onClick={() => setSection.mutate({ id: line.id, sectionType: ouvrSect === 'option' ? null : 'option' })} style={togBtn(ouvrSect === 'option', '#a855f7')}>O</button>
              <button className="btn-ghost" title="Supprimer" onClick={() => deleteLine.mutate(line.id)}>✕</button>
            </>
          )}
        </div>
        {/* Sous-détail éditable — masqué en mode vente. */}
        {!vente && comps.map((c) => {
          const cQty = Number(c.quantity) || 0;
          const cPerte = Number(c.perte) || 0;
          const isSubOuvrage = c.type === 'ouvrage';
          const subDebours = isSubOuvrage ? Number(deboursById.get(c.id) ?? 0) : 0;
          const subUnitPu = isSubOuvrage && cQty > 0 ? subDebours / cQty : 0;
          const cPu = isSubOuvrage ? subUnitPu : (Number(c.pu) || 0);
          const montant = cQty * cPu * (1 + cPerte / 100);
          return (
            <Fragment key={c.id}>
              <DropZone beforeLineId={c.id} parentLineId={line.id} dragCtx={dragCtx} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px 2px 24px', fontSize: 13, color: '#475569', opacity: dragCtx.dragLineId === c.id ? 0.4 : 1 }}>
                {!readOnly && <DragHandle lineId={c.id} dragCtx={dragCtx} />}
                <TypeBadge type={c.type} />
                {!isSubOuvrage && (
                  <CodeInput value={c.code_analytique} readOnly={readOnly} placeholder="Analy." title="Code analytique" style={{ width: 68 }}
                    onChange={(v) => updateLine.mutate({ id: c.id, patch: { codeAnalytique: v } })} />
                )}
                <input defaultValue={c.designation} disabled={readOnly} title="Désignation" style={{ flex: 1 }}
                  onBlur={(e) => e.target.value !== c.designation && updateLine.mutate({ id: c.id, patch: { designation: e.target.value, syncByCode: true } })} />
                <input defaultValue={cleanNum(c.quantity)} disabled={readOnly} title="Ratio/quantité" style={{ width: 56, textAlign: 'right' }}
                  onBlur={(e) => e.target.value !== cleanNum(c.quantity) && updateLine.mutate({ id: c.id, patch: { quantity: e.target.value || '0' } })} />
                <UnitSelect value={c.unit} token={token} readOnly={readOnly}
                  onChange={(v) => updateLine.mutate({ id: c.id, patch: { unit: v || null } })} />
                <input defaultValue={cleanNum(c.perte ?? '0')} disabled={readOnly} title="Perte %" style={{ width: 44, textAlign: 'right' }}
                  onBlur={(e) => e.target.value !== cleanNum(c.perte ?? '0') && updateLine.mutate({ id: c.id, patch: { perte: e.target.value || '0', syncByCode: true } })} />
                {isSubOuvrage ? (
                  <span style={{ width: 72, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#64748b', fontSize: 12 }}>{fmtEuro(subUnitPu, decimals)}</span>
                ) : (
                  <input defaultValue={cleanNum(c.pu)} disabled={readOnly} title="PU déboursé" style={{ width: 72, textAlign: 'right' }}
                    onBlur={(e) => e.target.value !== cleanNum(c.pu) && updateLine.mutate({ id: c.id, patch: { pu: e.target.value || '0', syncByCode: true } })} />
                )}
                <span style={{ width: 72, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#334155', fontWeight: 500 }}>{fmtEuro(montant, decimals)}</span>
                <button type="button" className="btn-ghost" title="Informations" onClick={() => onShowInfo(c)} style={infoBtn}>ⓘ</button>
                {!readOnly && <button className="btn-ghost" title="Supprimer" onClick={() => deleteLine.mutate(c.id)}>✕</button>}
              </div>
            </Fragment>
          );
        })}
        {!vente && <DropZone beforeLineId={null} parentLineId={line.id} dragCtx={dragCtx} />}
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
        <input defaultValue={line.designation} disabled={readOnly} style={{ flex: 1 }}
          onBlur={(e) => e.target.value !== line.designation && updateLine.mutate({ id: line.id, patch: { designation: e.target.value, syncByCode: !!line.code } })} />
        <button type="button" className="btn-ghost" title="Informations" onClick={() => onShowInfo(line)} style={infoBtn}>ⓘ</button>
        <input defaultValue={cleanNum(line.quantity)} disabled={readOnly} title="Quantité" style={{ width: 56, textAlign: 'right' }}
          onBlur={(e) => e.target.value !== cleanNum(line.quantity) && updateLine.mutate({ id: line.id, patch: { quantity: e.target.value || '0' } })} />
        <UnitSelect value={line.unit} token={token} readOnly={readOnly}
          onChange={(v) => updateLine.mutate({ id: line.id, patch: { unit: v || null } })} />
        {vente ? (
          <PvCell computed={puVente} forced={!!info?.forced} pending={setLinePv.isPending} decimals={decimals}
            onForce={(v) => setLinePv.mutate({ lineId: line.id, puVente: v, force: true })}
            onRelease={() => setLinePv.mutate({ lineId: line.id, puVente: null, force: false })} />
        ) : (
          <input defaultValue={cleanNum(line.pu)} disabled={readOnly} title="PU déboursé" style={{ width: 72, textAlign: 'right' }}
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

function SectionActions({ parentId, childCount, depth, vente, addLine, headerColor }: {
  parentId: string; childCount: number; depth: number; vente: boolean; headerColor: string;
} & Pick<Muts, 'addLine'>) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button type="button" title="Ajouter un élément dans cette section"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${headerColor}`, background: 'transparent', color: headerColor, fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, opacity: 0.8, flexShrink: 0 }}>+</button>
      {open && (
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 199 }} />
          <div style={{ position: 'absolute', top: 26, right: 0, zIndex: 200, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.15)', padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <ActionSquare label="O" title="Ajouter un ouvrage libre" color="var(--primary)"
              onClick={() => { addLine.mutate({ type: 'ouvrage', parentLineId: parentId, designation: 'Nouvel ouvrage', quantity: '1', sortOrder: childCount }); close(); }} />
            <ActionSquare label="T" title="Ajouter un texte libre" color="#d97706"
              onClick={() => { addLine.mutate({ type: 'texte', parentLineId: parentId, designation: 'Texte libre', sortOrder: childCount }); close(); }} />
            <ActionSquare label="S" title={`Ajouter un sous-niveau ${depth + 2}`} color="#64748b"
              onClick={() => { addLine.mutate({ type: 'sous_titre', parentLineId: parentId, designation: 'Sous-titre', sortOrder: childCount }); close(); }} />
          </div>
        </>
      )}
    </span>
  );
}

function UnitSelect({ value, token, readOnly, onChange }: {
  value: string | null | undefined;
  token: string | null;
  readOnly: boolean;
  onChange: (v: string) => void;
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
      style={{ width: 60, fontSize: 12, padding: '1px 2px', border: '1px solid #e2e8f0', borderRadius: 4, background: '#f8fafc', color: '#475569', textAlign: 'center', flexShrink: 0 }}
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

function OuvrageAddMenu({ parentId, childCount, addLine, insertOuvrage }: {
  parentId: string; childCount: number;
} & Pick<Muts, 'addLine' | 'insertOuvrage'>) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button type="button" title="Ajouter un élément dans cet ouvrage"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{ width: 22, height: 22, borderRadius: 4, border: '1px dashed #94a3b8', background: 'transparent', color: '#64748b', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0 }}>+</button>
      {open && (
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 199 }} />
          <div style={{ position: 'absolute', top: 26, right: 0, zIndex: 200, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.15)', padding: '8px 10px', display: 'flex', gap: 8 }}>
            <ActionSquare label="R" title="Ajouter une ressource" color="#64748b"
              onClick={() => { addLine.mutate({ type: 'ressource', parentLineId: parentId, designation: 'Nouvelle ressource', quantity: '1', pu: '0', sortOrder: childCount }); close(); }} />
            <ActionSquare label="O" title="Ajouter un sous-ouvrage" color="var(--primary)"
              onClick={() => { addLine.mutate({ type: 'ouvrage', parentLineId: parentId, designation: 'Sous-ouvrage', quantity: '1', sortOrder: childCount }); close(); }} />
          </div>
        </>
      )}
    </span>
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

function LineInfoModal({ line, components, deboursById, decimals, onClose }: {
  line: MontageLine; components: MontageLine[];
  deboursById: Map<string, string>; decimals: number; onClose: () => void;
}) {
  const isOuvrage = line.type === 'ouvrage';
  const debours = Number(deboursById.get(line.id) ?? 0);
  const row = (label: string, val: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="muted">{label}</span><span style={{ fontWeight: 500, textAlign: 'right' }}>{val}</span>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px, 96vw)', maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{isOuvrage ? 'Ouvrage' : 'Ressource'} — informations</h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <p className="muted" style={{ marginTop: 2 }}>Informations telles qu&apos;utilisées dans ce devis — sans incidence sur la bibliothèque société.</p>
        <div style={{ marginTop: 8 }}>
          {line.numero ? row('Numéro', <span style={{ fontFamily: 'monospace' }}>{line.numero}</span>) : null}
          {line.code ? row('Code produit', <span style={{ fontFamily: 'monospace' }}>{line.code}</span>) : null}
          {!isOuvrage && line.code_analytique ? row('Code analytique', <span style={{ fontFamily: 'monospace' }}>{line.code_analytique}</span>) : null}
          {row('Désignation', line.designation)}
          {line.unit ? row('Unité', line.unit) : null}
          {row('Quantité', line.quantity != null ? cleanNum(line.quantity) : '—')}
          {!isOuvrage ? row('PU déboursé', fmtEuro(line.pu, decimals)) : null}
          {!isOuvrage && line.perte ? row('Perte', `${line.perte} %`) : null}
          {row('Déboursé total', fmtEuro(debours, decimals))}
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
      </div>
    </div>
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

  const validParentTypes: string[] =
    source.type === 'ressource' ? ['ouvrage'] :
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

  return (
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
    </div>
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
  return { fontSize: 12, fontWeight: 700, width: 22, height: 22, borderRadius: 4, cursor: 'pointer', border: 'none', background: active ? color : '#f1f5f9', color: active ? '#fff' : '#94a3b8' };
}
