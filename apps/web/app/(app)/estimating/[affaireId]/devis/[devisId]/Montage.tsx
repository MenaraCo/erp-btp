'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { euro } from '@/lib/format';
import { fmtEuro, fmtNum } from '@/lib/preferences';

/** Élément valorisé côté vente (prix de vente + drapeau « forcé »). */
export interface SaleLineInfo { pv: string; forced: boolean }

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
interface Library { id: string; code: string; name: string }
interface Ouvrage { id: string; code: string; label: string; unit: string; debourse: string }
interface Page<T> { rows: T[] }

const SECTION_BG: Record<string, string> = { option: '#faf5ff', variante: '#fff7ed' };
const SECTION_BORDER: Record<string, string> = { option: '#a855f7', variante: '#f97316' };

export function Montage({
  versionId, token, lines, deboursById, onChanged, readOnly,
  mode = 'debours', saleById, decimals = 2,
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
  const roots = childrenOf(null);
  return (
    <div>
      {roots.map((l) => (
        <Node
          key={l.id} line={l} depth={0} childrenOf={childrenOf} subtree={subtree} sectionOf={sectionOf}
          token={token} versionId={versionId} readOnly={readOnly}
          addLine={addLine} insertOuvrage={insertOuvrage} updateLine={updateLine}
          deleteLine={deleteLine} setSection={setSection}
          vente={vente} valueOf={valueOf} saleById={saleById} setLinePv={setLinePv} decimals={decimals}
          onShowInfo={setInfoLine}
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
};

function Node({
  line, depth, childrenOf, subtree, sectionOf, token, versionId, readOnly,
  addLine, insertOuvrage, updateLine, deleteLine, setSection,
  vente, valueOf, saleById, setLinePv, decimals, onShowInfo,
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
  const vctx: VenteCtx = { vente, valueOf, saleById, setLinePv, decimals, onShowInfo };
  // Montant affiché : déboursé ou prix de vente selon le mode — toujours selon la règle
  // des décimales (préférences société).
  const fmtV = (n: number) => fmtEuro(n, decimals);

  if (line.type === 'titre' || line.type === 'sous_titre') {
    const ls = levelStyle(depth);
    return (
      <div style={{
        marginLeft: pad, marginBottom: 6, borderLeft: sect ? `3px solid ${SECTION_BORDER[sect]}` : '3px solid transparent',
        background: sect ? SECTION_BG[sect] : undefined, borderRadius: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: ls.bg, color: ls.color, borderRadius: 5 }}>
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
            {...vctx} />
        ))}
        {!readOnly && (
          <SectionActions parentId={line.id} childCount={kids.length} depth={depth}
            token={token} versionId={versionId} addLine={addLine} insertOuvrage={insertOuvrage} />
        )}
      </div>
    );
  }

  if (line.type === 'ouvrage') {
    const comps = childrenOf(line.id);
    const info = saleById?.get(line.id);
    const qtyN = Number(line.quantity) || 0;
    const puVente = vente && info && qtyN ? Number(info.pv) / qtyN : null;
    const puDebours = qtyN ? subtree(line) / qtyN : null; // PU déboursé unitaire (dérivé)
    return (
      <div style={{ marginLeft: pad }}>
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
          <input defaultValue={line.quantity ?? ''} disabled={readOnly} style={{ width: 64, textAlign: 'right' }}
            onBlur={(e) => e.target.value !== (line.quantity ?? '') && updateLine.mutate({ id: line.id, patch: { quantity: e.target.value || '0' } })} />
          {vente && (
            <PvCell computed={puVente} forced={!!info?.forced} pending={setLinePv.isPending} decimals={decimals}
              onForce={(v) => setLinePv.mutate({ lineId: line.id, puVente: v, force: true })}
              onRelease={() => setLinePv.mutate({ lineId: line.id, puVente: null, force: false })} />
          )}
          <span style={{ width: 90, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtV(valueOf(line))}</span>
          {!readOnly && <button className="btn-ghost" title="Supprimer" onClick={() => deleteLine.mutate(line.id)}>✕</button>}
        </div>
        {/* Sous-détail copié & éditable — masqué en mode vente (détail de débours). */}
        {!vente && comps.map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px 2px 24px', fontSize: 13, color: '#475569' }}>
            <input defaultValue={c.designation} disabled={readOnly} title="Désignation (devis uniquement)" style={{ flex: 1 }}
              onBlur={(e) => e.target.value !== c.designation && updateLine.mutate({ id: c.id, patch: { designation: e.target.value } })} />
            <input defaultValue={c.quantity ?? ''} disabled={readOnly} title="Ratio/quantité" style={{ width: 56, textAlign: 'right' }}
              onBlur={(e) => e.target.value !== (c.quantity ?? '') && updateLine.mutate({ id: c.id, patch: { quantity: e.target.value || '0' } })} />
            <input defaultValue={c.perte ?? '0'} disabled={readOnly} title="Perte %" style={{ width: 44, textAlign: 'right' }}
              onBlur={(e) => e.target.value !== (c.perte ?? '0') && updateLine.mutate({ id: c.id, patch: { perte: e.target.value || '0' } })} />
            <input defaultValue={c.pu ?? ''} disabled={readOnly} title="PU déboursé" style={{ width: 72, textAlign: 'right' }}
              onBlur={(e) => e.target.value !== (c.pu ?? '') && updateLine.mutate({ id: c.id, patch: { pu: e.target.value || '0' } })} />
            <button type="button" className="btn-ghost" title="Voir les informations de la ressource" onClick={() => onShowInfo(c)} style={infoBtn}>ⓘ</button>
            {!readOnly && <button className="btn-ghost" title="Supprimer" onClick={() => deleteLine.mutate(c.id)}>✕</button>}
          </div>
        ))}
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
        <input defaultValue={line.quantity ?? ''} disabled={readOnly} title="Quantité" style={{ width: 56, textAlign: 'right' }}
          onBlur={(e) => e.target.value !== (line.quantity ?? '') && updateLine.mutate({ id: line.id, patch: { quantity: e.target.value || '0' } })} />
        {vente ? (
          <PvCell computed={puVente} forced={!!info?.forced} pending={setLinePv.isPending} decimals={decimals}
            onForce={(v) => setLinePv.mutate({ lineId: line.id, puVente: v, force: true })}
            onRelease={() => setLinePv.mutate({ lineId: line.id, puVente: null, force: false })} />
        ) : (
          <input defaultValue={line.pu ?? ''} disabled={readOnly} title="PU déboursé" style={{ width: 72, textAlign: 'right' }}
            onBlur={(e) => e.target.value !== (line.pu ?? '') && updateLine.mutate({ id: line.id, patch: { pu: e.target.value || '0' } })} />
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

function SectionActions({
  parentId, childCount, depth, token, versionId, addLine, insertOuvrage,
}: {
  parentId: string; childCount: number; depth: number; token: string | null; versionId: string;
} & Pick<Muts, 'addLine' | 'insertOuvrage'>) {
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  // Niveau du sous-titre qui sera ajouté : un titre (depth 0) = niveau 1 → son enfant = niveau 2.
  const childLevel = depth + 2;
  const close = () => setMenu(false);
  return (
    <div style={{ padding: '6px 8px', marginLeft: (depth + 1) * 16, position: 'relative' }}>
      <button title="Ajouter…" onClick={() => setMenu((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26,
          fontSize: 16, fontWeight: 700, lineHeight: 1, color: 'var(--accent)', background: '#fff',
          border: '1px dashed var(--accent)', borderRadius: 6, cursor: 'pointer',
        }}>+</button>
      {menu && (
        <>
          {/* Couche de fermeture au clic extérieur */}
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
          <div style={{
            position: 'absolute', top: 34, left: 8, zIndex: 21, minWidth: 180,
            background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.14)', padding: 4,
          }}>
            <button style={menuItem()} onClick={() => { addLine.mutate({ type: 'ressource', parentLineId: parentId, designation: 'Ligne', quantity: '1', pu: '0', sortOrder: childCount }); close(); }}>
              <span style={menuIco('var(--muted)')}>+</span> Ligne
            </button>
            <button style={menuItem()} onClick={() => { setPicker(true); close(); }}>
              <span style={menuIco('var(--primary)')}>⊟</span> Ressources
            </button>
            <button style={menuItem()} onClick={() => { addLine.mutate({ type: 'texte', parentLineId: parentId, designation: 'Texte libre', sortOrder: childCount }); close(); }}>
              <span style={menuIco('#d97706')}>▤</span> Texte libre
            </button>
            <button style={menuItem()} onClick={() => { addLine.mutate({ type: 'sous_titre', parentLineId: parentId, designation: 'Sous-titre', sortOrder: childCount }); close(); }}>
              <span style={menuIco('var(--primary)')}>+</span> Sous-niveau {childLevel}
            </button>
          </div>
        </>
      )}
      {picker && <OuvragePicker token={token} parentId={parentId}
        onPick={(ouvrageId, quantity) => { insertOuvrage.mutate({ ouvrageId, parentLineId: parentId, quantity }); setPicker(false); }} />}
    </div>
  );
}

/** Style d'un item du menu contextuel « + ». */
function menuItem(): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '7px 10px', fontSize: 12.5, fontWeight: 500, color: 'var(--primary)',
    background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
  };
}
function menuIco(color: string): React.CSSProperties {
  return { display: 'inline-flex', width: 16, justifyContent: 'center', color, fontWeight: 700 };
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
          {row('Quantité', line.quantity ?? '—')}
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
                    <td style={{ textAlign: 'right' }}>{c.quantity ?? '—'}</td>
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

function OuvragePicker({ token, parentId, onPick }: { token: string | null; parentId: string; onPick: (ouvrageId: string, quantity: string) => void }) {
  const [libId, setLibId] = useState('');
  const [ouvrageId, setOuvrageId] = useState('');
  const [qty, setQty] = useState('1');
  const libs = useQuery({
    queryKey: ['libraries'], enabled: Boolean(token),
    queryFn: () => apiFetch<Page<Library>>('/libraries?pageSize=100', { token }),
  });
  const ouvrages = useQuery({
    queryKey: ['ouvrages', libId], enabled: Boolean(token && libId),
    queryFn: () => apiFetch<Page<Ouvrage>>(`/libraries/${libId}/ouvrages?pageSize=200`, { token }),
  });
  void parentId;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%', marginTop: 4, padding: 6, background: '#f8fafc', borderRadius: 6 }}>
      <select value={libId} onChange={(e) => { setLibId(e.target.value); setOuvrageId(''); }}>
        <option value="">Bibliothèque…</option>
        {(libs.data?.rows ?? []).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
      </select>
      <select value={ouvrageId} onChange={(e) => setOuvrageId(e.target.value)} style={{ flex: 1 }}>
        <option value="">Ouvrage…</option>
        {(ouvrages.data?.rows ?? []).map((o) => <option key={o.id} value={o.id}>{o.code} — {o.label} ({euro(o.debourse)})</option>)}
      </select>
      <input value={qty} onChange={(e) => setQty(e.target.value)} title="Quantité" style={{ width: 56, textAlign: 'right' }} />
      <button className="btn" disabled={!ouvrageId} onClick={() => onPick(ouvrageId, qty || '1')}>Insérer</button>
    </div>
  );
}
function togBtn(active: boolean, color: string): React.CSSProperties {
  return {
    fontSize: 12, fontWeight: 700, width: 22, height: 22, borderRadius: 4, cursor: 'pointer',
    border: 'none', background: active ? color : '#f1f5f9', color: active ? '#fff' : '#94a3b8',
  };
}
