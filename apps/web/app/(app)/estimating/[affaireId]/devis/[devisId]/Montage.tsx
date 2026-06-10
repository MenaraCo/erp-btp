'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { fmtEuro, fmtNum, cleanNum } from '@/lib/preferences';

/** Élément valorisé côté vente (prix de vente + drapeau « forcé »). */
export interface SaleLineInfo { pv: string; forced: boolean }

/** Élément glissé depuis le panneau bibliothèque. */
export interface DragItem { kind: 'ouvrage' | 'ressource'; id: string; code: string; label: string; unit: string | null; debourse?: string }

export interface MontageLine {
  id: string;
  parent_line_id: string | null;
  type: string; // titre | sous_titre | ouvrage | ressource | texte
  code: string | null;
  designation: string;
  unit: string | null;
  quantity: string | null;
  pu: string | null;
  perte: string | null;
  section_type: 'option' | 'variante' | null;
  source_ouvrage_id: string | null;
  sort_order: number;
  numero?: string | null;       // numéro hiérarchique calculé serveur (1, 1.1, 1.2.1…)
  num_custom?: string | null;   // override manuel du numéro (titre/sous-titre)
}

/* Style d'en-tête de section par profondeur (titre foncé → sous-niveaux dégressifs). */
function levelStyle(depth: number): { bg: string; color: string; num: string } {
  const cfgs = [
    { bg: 'var(--primary)', color: '#fff', num: 'rgba(255,255,255,0.7)' },        // titre
    { bg: '#e2e8f0', color: 'var(--primary)', num: 'var(--accent)' },             // sous-titre n1
    { bg: '#eef2f7', color: 'var(--primary)', num: 'var(--accent)' },             // n2
    { bg: '#f1f5f9', color: '#334155', num: 'var(--accent)' },                    // n3+
  ];
  return cfgs[Math.min(depth, cfgs.length - 1)];
}
const SECTION_BG: Record<string, string> = { option: '#faf5ff', variante: '#fff7ed' };
const SECTION_BORDER: Record<string, string> = { option: '#a855f7', variante: '#f97316' };

export function Montage({
  versionId, token, lines, deboursById, onChanged, readOnly,
  mode = 'debours', saleById, decimals = 2, acceptDrop = false,
}: {
  versionId: string;
  token: string | null;
  lines: MontageLine[];
  deboursById: Map<string, string>; // lineId -> déboursé (items priced)
  onChanged: () => void;
  readOnly: boolean;
  /** 'debours' = sous-détail & déboursés ; 'vente' = prix de vente par ligne (forçage en place). */
  mode?: 'debours' | 'vente';
  /** lineId -> info vente (prix de vente, forcé) — requis en mode 'vente'. */
  saleById?: Map<string, SaleLineInfo>;
  /** Nb de décimales d'affichage (préférences) — mode vente. */
  decimals?: number;
  /** Active les zones de dépôt (bibliothèque volante). */
  acceptDrop?: boolean;
}) {
  const vente = mode === 'vente';
  const childrenOf = (pid: string | null) =>
    lines.filter((l) => l.parent_line_id === pid).sort((a, b) => a.sort_order - b.sort_order);

  // Déboursé du sous-arbre : un ouvrage porte son déboursé agrégé (ne pas descendre dans ses
  // composants) ; un titre additionne ses enfants.
  const subtree = (l: MontageLine): number => {
    if (l.type === 'ouvrage' || l.type === 'ressource') return Number(deboursById.get(l.id) ?? 0);
    return childrenOf(l.id).reduce((s, c) => s + subtree(c), 0);
  };
  // Valeur affichée : déboursé (mode débours) ou prix de vente agrégé (mode vente).
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

  const [infoLine, setInfoLine] = useState<MontageLine | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // true quand un élément de la bibliothèque survole le montage (pour afficher les zones)
  const [dragActive, setDragActive] = useState(false);

  const onDropItem = (parentId: string | null, item: DragItem) => {
    if (item.kind === 'ouvrage') {
      insertOuvrage.mutate({ ouvrageId: item.id, parentLineId: parentId, quantity: '1' });
    } else {
      addLine.mutate({ type: 'ressource', parentLineId: parentId, designation: item.label, code: item.code, unit: item.unit ?? '', quantity: '1', pu: item.debourse ?? '0' });
    }
  };

  const roots = childrenOf(null);
  return (
    <div
      onDragEnter={() => { if (acceptDrop) setDragActive(true); }}
      onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as HTMLElement)) { setDragActive(false); setDragOverId(null); } }}
      onDragOver={(e) => { if (acceptDrop) e.preventDefault(); }}
      onDrop={(e) => {
        // Le drop sur la racine (hors d'une section) est ignoré — un message visuel suffit.
        if (!acceptDrop) return;
        e.preventDefault();
        setDragActive(false);
        setDragOverId(null);
      }}
    >
      {roots.map((l) => (
        <Node
          key={l.id} line={l} depth={0} childrenOf={childrenOf} subtree={subtree} sectionOf={sectionOf}
          token={token} versionId={versionId} readOnly={readOnly}
          addLine={addLine} insertOuvrage={insertOuvrage} updateLine={updateLine}
          deleteLine={deleteLine} setSection={setSection}
          vente={vente} valueOf={valueOf} saleById={saleById} setLinePv={setLinePv} decimals={decimals}
          onShowInfo={setInfoLine}
          acceptDrop={acceptDrop} dragActive={dragActive} dragOverId={dragOverId}
          onDragEnter={setDragOverId} onDragLeave={() => setDragOverId(null)} onDropItem={onDropItem}
        />
      ))}
      {!readOnly && (
        <button className="btn" style={{ marginTop: 8 }}
          onClick={() => addLine.mutate({ type: 'titre', designation: 'Nouveau titre', sortOrder: roots.length })}>
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
    </div>
  );
}

type Muts = {
  addLine: ReturnType<typeof useMutation<unknown, Error, Record<string, unknown>>>;
  insertOuvrage: ReturnType<typeof useMutation<unknown, Error, { ouvrageId: string; parentLineId: string | null; quantity: string }>>;
  updateLine: ReturnType<typeof useMutation<unknown, Error, { id: string; patch: Record<string, unknown> }>>;
  deleteLine: ReturnType<typeof useMutation<unknown, Error, string>>;
  setSection: ReturnType<typeof useMutation<unknown, Error, { id: string; sectionType: 'option' | 'variante' | null }>>;
};

/** Props du mode vente (prix de vente + forçage en place) + actions transverses. */
type VenteCtx = {
  vente: boolean;
  valueOf: (l: MontageLine) => number;
  saleById?: Map<string, SaleLineInfo>;
  setLinePv: ReturnType<typeof useMutation<unknown, Error, { lineId: string; puVente: string | null; force: boolean }>>;
  decimals: number;
  /** Ouvre la fenêtre d'informations d'une ligne (ouvrage/ressource). */
  onShowInfo: (l: MontageLine) => void;
  /** Drag & drop depuis la bibliothèque volante. */
  acceptDrop: boolean;
  /** true quand un glisser est en cours (affiche les zones de dépôt sur tous les titres). */
  dragActive: boolean;
  dragOverId: string | null;
  onDragEnter: (id: string) => void;
  onDragLeave: () => void;
  onDropItem: (parentId: string | null, item: DragItem) => void;
};

function Node({
  line, depth, childrenOf, subtree, sectionOf, token, versionId, readOnly,
  addLine, insertOuvrage, updateLine, deleteLine, setSection,
  vente, valueOf, saleById, setLinePv, decimals, onShowInfo,
  acceptDrop, dragActive, dragOverId, onDragEnter, onDragLeave, onDropItem,
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
  // Contexte vente propagé tel quel aux enfants.
  const vctx: VenteCtx = { vente, valueOf, saleById, setLinePv, decimals, onShowInfo, acceptDrop, dragActive, dragOverId, onDragEnter, onDragLeave, onDropItem };
  // Montant affiché : déboursé ou prix de vente selon le mode — toujours selon la règle
  // des décimales (préférences société).
  const fmtV = (n: number) => fmtEuro(n, decimals);

  if (line.type === 'titre' || line.type === 'sous_titre') {
    const ls = levelStyle(depth);
    const isDropTarget = acceptDrop && dragOverId === line.id;
    // Zone potentielle de dépôt (drag en cours mais pas encore sur ce titre)
    const isDropZone = acceptDrop && dragActive && dragOverId !== line.id;
    return (
      <div
        onDragOver={(e) => { if (acceptDrop) { e.preventDefault(); e.stopPropagation(); onDragEnter(line.id); } }}
        onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as HTMLElement)) { onDragLeave(); } }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const raw = e.dataTransfer.getData('application/json'); if (raw) { try { onDropItem(line.id, JSON.parse(raw)); } catch {} } onDragLeave(); }}
        style={{
          marginLeft: pad, marginBottom: 6,
          borderLeft: sect ? `3px solid ${SECTION_BORDER[sect]}` : isDropTarget ? '3px solid var(--accent)' : isDropZone ? '3px dashed #cbd5e1' : '3px solid transparent',
          background: sect ? SECTION_BG[sect] : undefined, borderRadius: 6,
          outline: isDropTarget ? '2px dashed var(--accent)' : undefined, outlineOffset: -2,
          opacity: isDropTarget ? 0.95 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: isDropTarget ? ls.bg : ls.bg, color: ls.color, borderRadius: 5 }}>
          {/* Numéro hiérarchique (calculé serveur) + champ de forçage juste à côté */}
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: ls.num, minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {line.numero ?? ''}
          </span>
          {!readOnly && (
            <input title="N° personnalisé (remplace le numéro automatique)" placeholder={line.numero ?? 'N°'} defaultValue={line.num_custom ?? ''}
              onBlur={(e) => (e.target.value || '') !== (line.num_custom ?? '') && updateLine.mutate({ id: line.id, patch: { numCustom: e.target.value } })}
              style={{ width: 48, fontSize: 11, fontFamily: 'monospace', textAlign: 'center', background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, color: ls.color, padding: '2px 4px' }} />
          )}
          <input className="title-input" defaultValue={line.designation} disabled={readOnly}
            onBlur={(e) => e.target.value !== line.designation && updateLine.mutate({ id: line.id, patch: { designation: e.target.value } })}
            style={{ fontWeight: line.type === 'titre' ? 700 : 600, textTransform: line.type === 'titre' ? 'uppercase' : 'none', flex: 1, border: '1px solid transparent', background: 'transparent', color: ls.color }} />
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: ls.color }}>{fmtV(valueOf(line))}</span>
          {!readOnly && (
            <>
              <button title="Variante" onClick={() => setSection.mutate({ id: line.id, sectionType: sect === 'variante' ? null : 'variante' })}
                style={togBtn(sect === 'variante', '#f97316')}>V</button>
              <button title="Option" onClick={() => setSection.mutate({ id: line.id, sectionType: sect === 'option' ? null : 'option' })}
                style={togBtn(sect === 'option', '#a855f7')}>O</button>
              <button title="Supprimer" className="btn-ghost" onClick={() => deleteLine.mutate(line.id)} style={{ color: ls.color }}>✕</button>
            </>
          )}
        </div>
        {kids.map((k) => (
          <Node key={k.id} line={k} depth={depth + 1} childrenOf={childrenOf} subtree={subtree} sectionOf={sectionOf}
            token={token} versionId={versionId} readOnly={readOnly}
            addLine={addLine} insertOuvrage={insertOuvrage} updateLine={updateLine} deleteLine={deleteLine} setSection={setSection}
            {...vctx}
          />
        ))}
        {!readOnly && (
          <SectionActions parentId={line.id} childCount={kids.length} depth={depth} vente={vente} addLine={addLine} />
        )}
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
    const isOuvrDrop = acceptDrop && dragOverId === line.id;
    return (
      <div
        onDragOver={(e) => { if (acceptDrop) { e.preventDefault(); e.stopPropagation(); onDragEnter(line.id); } }}
        onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as HTMLElement)) onDragLeave(); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation();
          const raw = e.dataTransfer.getData('application/json');
          if (raw) {
            try {
              const item: DragItem = JSON.parse(raw);
              if (item.kind === 'ressource') {
                // Ressource de bibliothèque → enfant de cet ouvrage (même logique que + Ressource interne)
                onDropItem(line.id, item);
              } else {
                // Ouvrage de bibliothèque → sibling (au niveau du parent de cet ouvrage)
                onDropItem(line.parent_line_id, item);
              }
            } catch {}
          }
          onDragLeave();
        }}
        style={{
          marginLeft: pad,
          borderLeft: ouvrSect ? `3px solid ${SECTION_BORDER[ouvrSect]}` : isOuvrDrop ? '3px solid var(--accent)' : undefined,
          background: ouvrSect ? SECTION_BG[ouvrSect] : undefined,
          borderRadius: ouvrSect ? 6 : isOuvrDrop ? 6 : undefined,
          marginBottom: ouvrSect ? 4 : undefined,
          outline: isOuvrDrop ? '2px dashed var(--accent)' : undefined,
          outlineOffset: isOuvrDrop ? -2 : undefined,
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.numero ?? ''}</span>
          {!readOnly && <NumBox line={line} onChange={(v) => updateLine.mutate({ id: line.id, patch: { numCustom: v } })} />}
          <input defaultValue={line.designation} disabled={readOnly} title="Désignation (devis uniquement)" style={{ flex: 1, fontWeight: 500 }}
            onBlur={(e) => e.target.value !== line.designation && updateLine.mutate({ id: line.id, patch: { designation: e.target.value } })} />
          <button type="button" className="btn-ghost" title="Voir les informations de l'ouvrage" onClick={() => onShowInfo(line)} style={infoBtn}>ⓘ</button>
          {!vente && (
            <span style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }} title="PU déboursé unitaire">
              PU&nbsp;<span style={{ fontVariantNumeric: 'tabular-nums', color: '#334155', fontWeight: 600 }}>{puDebours != null ? fmtV(puDebours) : '—'}</span>
            </span>
          )}
          <label style={{ fontSize: 12, color: '#6b7280' }}>Qté</label>
          <input defaultValue={cleanNum(line.quantity)} disabled={readOnly} style={{ width: 64, textAlign: 'right' }}
            onBlur={(e) => e.target.value !== cleanNum(line.quantity) && updateLine.mutate({ id: line.id, patch: { quantity: e.target.value || '0' } })} />
          {vente && (
            <PvCell computed={puVente} forced={!!info?.forced} pending={setLinePv.isPending} decimals={decimals}
              onForce={(v) => setLinePv.mutate({ lineId: line.id, puVente: v, force: true })}
              onRelease={() => setLinePv.mutate({ lineId: line.id, puVente: null, force: false })} />
          )}
          <span style={{ width: 90, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtV(valueOf(line))}</span>
          {!readOnly && (
            <>
              <button title="Variante" onClick={() => setSection.mutate({ id: line.id, sectionType: ouvrSect === 'variante' ? null : 'variante' })}
                style={togBtn(ouvrSect === 'variante', '#f97316')}>V</button>
              <button title="Option (hors total)" onClick={() => setSection.mutate({ id: line.id, sectionType: ouvrSect === 'option' ? null : 'option' })}
                style={togBtn(ouvrSect === 'option', '#a855f7')}>O</button>
              <button className="btn-ghost" title="Supprimer" onClick={() => deleteLine.mutate(line.id)}>✕</button>
            </>
          )}
        </div>
        {/* Sous-détail copié & éditable — masqué en mode vente (détail de débours). */}
        {!vente && comps.map((c) => {
          const cQty = Number(c.quantity) || 0;
          const cPu  = Number(c.pu) || 0;
          const cPerte = Number(c.perte) || 0;
          const montant = cQty * cPu * (1 + cPerte / 100);
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px 2px 24px', fontSize: 13, color: '#475569' }}>
              <input defaultValue={c.designation} disabled={readOnly} title="Désignation (devis uniquement)" style={{ flex: 1 }}
                onBlur={(e) => e.target.value !== c.designation && updateLine.mutate({ id: c.id, patch: { designation: e.target.value } })} />
              <input defaultValue={cleanNum(c.quantity)} disabled={readOnly} title="Ratio/quantité" style={{ width: 56, textAlign: 'right' }}
                onBlur={(e) => e.target.value !== cleanNum(c.quantity) && updateLine.mutate({ id: c.id, patch: { quantity: e.target.value || '0' } })} />
              <input defaultValue={cleanNum(c.perte ?? '0')} disabled={readOnly} title="Perte %" style={{ width: 44, textAlign: 'right' }}
                onBlur={(e) => e.target.value !== cleanNum(c.perte ?? '0') && updateLine.mutate({ id: c.id, patch: { perte: e.target.value || '0' } })} />
              <input defaultValue={cleanNum(c.pu)} disabled={readOnly} title="PU déboursé" style={{ width: 72, textAlign: 'right' }}
                onBlur={(e) => e.target.value !== cleanNum(c.pu) && updateLine.mutate({ id: c.id, patch: { pu: e.target.value || '0' } })} />
              {/* Montant = ratio × PU × (1 + perte%) — contribution à 1 unité de l'ouvrage */}
              <span style={{ width: 72, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#334155', fontWeight: 500 }} title="Ratio × PU × (1 + perte)">
                {fmtEuro(montant, decimals)}
              </span>
              <button type="button" className="btn-ghost" title="Voir les informations de la ressource" onClick={() => onShowInfo(c)} style={infoBtn}>ⓘ</button>
              {!readOnly && <button className="btn-ghost" title="Supprimer" onClick={() => deleteLine.mutate(c.id)}>✕</button>}
            </div>
          );
        })}
        {/* Carré R pour ajouter une ressource enfant directement dans cet ouvrage */}
        {!vente && !readOnly && (
          <div style={{ padding: '3px 8px 3px 24px' }}>
            <ActionSquare label="R" title="Ajouter une ressource à cet ouvrage" color="#64748b"
              onClick={() => addLine.mutate({ type: 'ressource', parentLineId: line.id, designation: 'Nouvelle ressource', quantity: '1', pu: '0', sortOrder: comps.length })} />
          </div>
        )}
      </div>
    );
  }

  if (line.type === 'ressource') {
    const info = saleById?.get(line.id);
    const qtyN = Number(line.quantity) || 0;
    const puVente = vente && info && qtyN ? Number(info.pv) / qtyN : null;
    return (
      <div style={{ marginLeft: pad, display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', fontSize: 13 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.numero ?? ''}</span>
        {!readOnly && <NumBox line={line} onChange={(v) => updateLine.mutate({ id: line.id, patch: { numCustom: v } })} />}
        <input defaultValue={line.designation} disabled={readOnly} style={{ flex: 1 }}
          onBlur={(e) => e.target.value !== line.designation && updateLine.mutate({ id: line.id, patch: { designation: e.target.value } })} />
        <button type="button" className="btn-ghost" title="Voir les informations de la ressource" onClick={() => onShowInfo(line)} style={infoBtn}>ⓘ</button>
        <input defaultValue={cleanNum(line.quantity)} disabled={readOnly} title="Quantité" style={{ width: 56, textAlign: 'right' }}
          onBlur={(e) => e.target.value !== cleanNum(line.quantity) && updateLine.mutate({ id: line.id, patch: { quantity: e.target.value || '0' } })} />
        {vente ? (
          <PvCell computed={puVente} forced={!!info?.forced} pending={setLinePv.isPending} decimals={decimals}
            onForce={(v) => setLinePv.mutate({ lineId: line.id, puVente: v, force: true })}
            onRelease={() => setLinePv.mutate({ lineId: line.id, puVente: null, force: false })} />
        ) : (
          <input defaultValue={cleanNum(line.pu)} disabled={readOnly} title="PU déboursé" style={{ width: 72, textAlign: 'right' }}
            onBlur={(e) => e.target.value !== cleanNum(line.pu) && updateLine.mutate({ id: line.id, patch: { pu: e.target.value || '0' } })} />
        )}
        <span style={{ width: 80, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtV(valueOf(line))}</span>
        {!readOnly && <button className="btn-ghost" title="Supprimer" onClick={() => deleteLine.mutate(line.id)}>✕</button>}
      </div>
    );
  }

  // texte libre
  return (
    <div style={{ marginLeft: pad, padding: '3px 8px', fontStyle: 'italic', color: '#64748b', display: 'flex', gap: 6 }}>
      <input defaultValue={line.designation} disabled={readOnly} style={{ flex: 1, fontStyle: 'italic' }}
        onBlur={(e) => e.target.value !== line.designation && updateLine.mutate({ id: line.id, patch: { designation: e.target.value } })} />
      {!readOnly && <button className="btn-ghost" title="Supprimer" onClick={() => deleteLine.mutate(line.id)}>✕</button>}
    </div>
  );
}

/**
 * Barre d'actions compacte d'une section (titre / sous-titre).
 * Affiche des petits carrés lettrés directement cliquables — pas de menu déroulant.
 *   R = Ressource libre  (débours uniquement)
 *   O = Ouvrage libre
 *   T = Texte libre
 *   S = Sous-section
 */
function SectionActions({
  parentId, childCount, depth, vente, addLine,
}: {
  parentId: string; childCount: number; depth: number; vente: boolean;
} & Pick<Muts, 'addLine'>) {
  const childLevel = depth + 2;
  return (
    <div style={{ padding: '3px 8px', marginLeft: (depth + 1) * 16, display: 'flex', gap: 4, alignItems: 'center' }}>
      {!vente && (
        <ActionSquare label="R" title="Ajouter une ressource libre" color="#64748b"
          onClick={() => addLine.mutate({ type: 'ressource', parentLineId: parentId, designation: 'Nouvelle ressource', quantity: '1', pu: '0', sortOrder: childCount })} />
      )}
      <ActionSquare label="O" title="Ajouter un ouvrage libre" color="var(--primary)"
        onClick={() => addLine.mutate({ type: 'ouvrage', parentLineId: parentId, designation: 'Nouvel ouvrage', quantity: '1', sortOrder: childCount })} />
      <ActionSquare label="T" title="Ajouter un texte libre" color="#d97706"
        onClick={() => addLine.mutate({ type: 'texte', parentLineId: parentId, designation: 'Texte libre', sortOrder: childCount })} />
      <ActionSquare label="S" title={`Ajouter un sous-niveau ${childLevel}`} color="#64748b"
        onClick={() => addLine.mutate({ type: 'sous_titre', parentLineId: parentId, designation: 'Sous-titre', sortOrder: childCount })} />
    </div>
  );
}

/** Petit carré letté cliquable — R, O, T ou S. Le `title` s'affiche au survol. */
function ActionSquare({ label, title, color, onClick }: {
  label: string; title: string; color: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: 22, height: 22, borderRadius: 4, border: `1px solid ${color}`,
        background: 'transparent', color, fontSize: 10, fontWeight: 700,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        lineHeight: 1, flexShrink: 0,
      }}
    >{label}</button>
  );
}

/** Bouton « ⓘ » d'accès aux informations d'une ligne. */
const infoBtn: React.CSSProperties = {
  color: 'var(--primary)', fontSize: 14, padding: '0 4px', lineHeight: 1, flexShrink: 0,
};

/**
 * Champ de numéro personnalisé (forçage) pour lignes ouvrage/ressource — affiché juste à côté
 * du numéro automatique. Le numéro saisi prime sur l'automatique (convention CHIFFRAGE).
 */
function NumBox({ line, onChange }: { line: MontageLine; onChange: (v: string) => void }) {
  return (
    <input
      title="N° personnalisé (remplace le numéro automatique)"
      placeholder={line.numero ?? 'N°'}
      defaultValue={line.num_custom ?? ''}
      onBlur={(e) => (e.target.value || '') !== (line.num_custom ?? '') && onChange(e.target.value)}
      style={{
        width: 48, fontSize: 11, fontFamily: 'monospace', textAlign: 'center',
        background: '#fff', border: '1px solid var(--border)', borderRadius: 4,
        color: 'var(--primary)', padding: '2px 4px', flexShrink: 0,
      }}
    />
  );
}

/**
 * Fenêtre d'informations (lecture seule) d'une ligne ouvrage/ressource du devis.
 * Affiche les données TELLES QU'UTILISÉES DANS LE DEVIS (copies) — n'expose ni ne modifie
 * la bibliothèque société.
 */
function LineInfoModal({ line, components, deboursById, decimals, onClose }: {
  line: MontageLine;
  components: MontageLine[];
  deboursById: Map<string, string>;
  decimals: number;
  onClose: () => void;
}) {
  const isOuvrage = line.type === 'ouvrage';
  const debours = Number(deboursById.get(line.id) ?? 0);
  const row = (label: string, val: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="muted">{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right' }}>{val}</span>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px, 96vw)', maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{isOuvrage ? 'Ouvrage' : 'Ressource'} — informations</h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <p className="muted" style={{ marginTop: 2 }}>
          Informations telles qu’utilisées dans ce devis — sans incidence sur la bibliothèque société.
        </p>
        <div style={{ marginTop: 8 }}>
          {line.numero ? row('Numéro', <span style={{ fontFamily: 'monospace' }}>{line.numero}</span>) : null}
          {line.code ? row('Code', <span style={{ fontFamily: 'monospace' }}>{line.code}</span>) : null}
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
              <thead><tr>
                <th>Désignation</th>
                <th style={{ textAlign: 'right' }}>Qté</th>
                <th style={{ textAlign: 'right' }}>Perte</th>
                <th style={{ textAlign: 'right' }}>PU déboursé</th>
              </tr></thead>
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

/**
 * Prix de vente unitaire éditable en place (mode vente / onglet Devis client).
 * Saisir une valeur force le prix (champ orange + cadenas pour libérer) ; le cadenas
 * rétablit le prix calculé. Pas de champ « Forcer » séparé.
 */
export function PvCell({ computed, forced, pending, decimals, onForce, onRelease }: {
  computed: number | null;
  forced: boolean;
  pending: boolean;
  decimals: number;
  onForce: (v: string) => void;
  onRelease: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const shown = focused ? draft : (computed != null ? fmtNum(computed, decimals) : '');
  const commit = () => {
    setFocused(false);
    const cleaned = draft.replace(',', '.').replace(/[^0-9.]/g, '');
    if (cleaned === '') return; // vide → aucun changement
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return;
    if (!forced && computed != null && Math.abs(n - computed) < 1e-6) return;
    onForce(cleaned);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
      <input
        style={{
          width: 84, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
          ...(forced ? { borderColor: 'var(--accent)', background: '#fff7ed', color: 'var(--accent)', fontWeight: 600 } : {}),
        }}
        value={shown}
        disabled={pending}
        onFocus={() => { setFocused(true); setDraft(computed != null ? String(Number(computed.toFixed(decimals))) : ''); }}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={commit}
        onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); (ev.target as HTMLInputElement).blur(); } }}
      />
      {forced && (
        <button type="button" className="btn-ghost" title="Libérer le prix forcé (revenir au prix calculé)"
          disabled={pending} onClick={onRelease} style={{ padding: '2px 6px', color: 'var(--accent)', lineHeight: 1 }}>🔒</button>
      )}
    </span>
  );
}

function togBtn(active: boolean, color: string): React.CSSProperties {
  return {
    fontSize: 12, fontWeight: 700, width: 22, height: 22, borderRadius: 4, cursor: 'pointer',
    border: 'none', background: active ? color : '#f1f5f9', color: active ? '#fff' : '#94a3b8',
  };
}
