'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { usePreferences, fmtEuro, cleanNum } from '@/lib/preferences';
import { SortHeader, SortState, nextSort, applySort } from '@/components/SortHeader';

/* ─────────── types ─────────── */
interface Ouvrage {
  id: string; libraryId: string; code: string; label: string; unit: string; debourse: string;
  description?: string | null; categorie?: string | null; lotId?: string | null;
}
interface Component {
  id: string; kind: string; quantity: string | null; perte: string | null; rate: string | null;
  child_resource_id: string | null; child_ouvrage_id: string | null;
  childCode: string | null; childLabel: string | null; childUnit: string | null;
  childUnitCost: string | null; childNature: string | null;
}
interface Unit { id: string; abrev: string; label: string }
interface Lot { id: string; code: string; label: string }
interface ResourcePick { id: string; code: string; label: string; unit: string; unitCost: string; nature: string }

const NAT: Record<string, string> = { material: 'Mat.', labor: 'MO', equipment: 'Matér.', subcontract: 'ST' };

const montantOf = (c: Component) => (Number(c.quantity) || 0) * (1 + (Number(c.perte) || 0) / 100) * (Number(c.childUnitCost) || 0);
/* Colonnes (re)positionnables/triables de la composition (hors # et actions). */
interface CompoCol { key: string; label: string; right?: boolean; accessor: (c: Component) => unknown }
const COMPO_COLS: CompoCol[] = [
  { key: 'type', label: 'Type', accessor: (c) => c.childNature },
  { key: 'code', label: 'Code', accessor: (c) => c.childCode },
  { key: 'label', label: 'Désignation', accessor: (c) => c.childLabel },
  { key: 'unit', label: 'Unité', accessor: (c) => c.childUnit },
  { key: 'ratio', label: 'Ratio', right: true, accessor: (c) => Number(c.quantity) },
  { key: 'perte', label: 'Perte', right: true, accessor: (c) => Number(c.perte) },
  { key: 'pu', label: 'PU déb.', right: true, accessor: (c) => Number(c.childUnitCost) },
  { key: 'montant', label: 'Montant', right: true, accessor: montantOf },
];
const COMPO_COL_STORAGE = 'erp.ouvrage.compoColOrder';

export default function OuvrageEditorPage() {
  const { token } = useAuth();
  const { nb_decimales: nbDec } = usePreferences();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const ouvrageId = String(params.ouvrageId);
  const libIdParam = searchParams.get('lib');
  const isNew = ouvrageId === 'new';
  const [err, setErr] = useState<string | null>(null);

  /* Référentiels */
  const units = useQuery({ queryKey: ['params-units'], enabled: Boolean(token), queryFn: () => apiFetch<Unit[]>('/params/units', { token }) });
  const lots = useQuery({ queryKey: ['params-lots'], enabled: Boolean(token), queryFn: () => apiFetch<Lot[]>('/params/lots', { token }) });

  /* Ouvrage existant */
  const ouvrage = useQuery({
    queryKey: ['ouvrage', ouvrageId],
    enabled: Boolean(token && !isNew),
    queryFn: () => apiFetch<Ouvrage>(`/ouvrages/${ouvrageId}`, { token }),
  });
  const components = useQuery({
    queryKey: ['ouvrage-components', ouvrageId],
    enabled: Boolean(token && !isNew),
    queryFn: () => apiFetch<Component[]>(`/ouvrages/${ouvrageId}/components`, { token }),
  });

  /* Formulaire infos */
  const [form, setForm] = useState({ code: '', label: '', unit: 'U', description: '', categorie: '', lotId: '' });
  const [initDone, setInitDone] = useState(false);
  useEffect(() => {
    if (ouvrage.data && !initDone) {
      const o = ouvrage.data;
      setForm({ code: o.code, label: o.label, unit: o.unit, description: o.description ?? '', categorie: o.categorie ?? '', lotId: o.lotId ?? '' });
      setInitDone(true);
    }
  }, [ouvrage.data, initDone]);

  const libId = libIdParam || ''; // pour création (depuis quelle bibliothèque)

  const save = useMutation({
    mutationFn: () => {
      const body = { code: form.code, label: form.label, unit: form.unit, description: form.description || null, categorie: form.categorie || null, lotId: form.lotId || null };
      return isNew
        ? apiFetch<Ouvrage>(`/libraries/${libId}/ouvrages`, { method: 'POST', body, token })
        : apiFetch<Ouvrage>(`/ouvrages/${ouvrageId}`, { method: 'PATCH', body, token });
    },
    onSuccess: (o) => {
      qc.invalidateQueries({ queryKey: ['ouvrages', libId] });
      if (isNew) router.replace(`/estimating/bibliotheque/ouvrages/${o.id}`);
      else { qc.invalidateQueries({ queryKey: ['ouvrage', ouvrageId] }); setErr(null); }
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible.'),
  });

  /* Composition : modale picker */
  const [pickerOpen, setPickerOpen] = useState(false);

  const addComp = useMutation({
    mutationFn: (r: ResourcePick) => apiFetch(`/ouvrages/${ouvrageId}/components`, {
      method: 'POST', body: { kind: 'resource', childResourceId: r.id, quantity: '1', perte: '0' }, token,
    }),
    onSuccess: () => { refreshComp(); setPickerOpen(false); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Ajout impossible.'),
  });
  const addSubOuvrage = useMutation({
    mutationFn: (o: { id: string }) => apiFetch(`/ouvrages/${ouvrageId}/components`, {
      method: 'POST', body: { kind: 'sub_ouvrage', childOuvrageId: o.id, quantity: '1', perte: '0' }, token,
    }),
    onSuccess: () => { refreshComp(); setPickerOpen(false); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Ajout impossible.'),
  });
  const deleteOuvrage = useMutation({
    mutationFn: () => apiFetch(`/ouvrages/${ouvrageId}`, { method: 'DELETE', token }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ouvrages'] }); router.push('/estimating/bibliotheque/ouvrages'); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Suppression impossible.'),
  });
  const updateComp = useMutation({
    mutationFn: (v: { cid: string; quantity?: string; perte?: string }) => apiFetch(`/ouvrages/${ouvrageId}/components/${v.cid}`, {
      method: 'PATCH', body: { quantity: v.quantity, perte: v.perte }, token,
    }),
    onSuccess: refreshComp,
  });
  const delComp = useMutation({
    mutationFn: (cid: string) => apiFetch(`/ouvrages/${ouvrageId}/components/${cid}`, { method: 'DELETE', token }),
    onSuccess: refreshComp,
  });
  function refreshComp() {
    qc.invalidateQueries({ queryKey: ['ouvrage-components', ouvrageId] });
    qc.invalidateQueries({ queryKey: ['ouvrage', ouvrageId] });
  }

  const debourse = ouvrage.data?.debourse ?? '0';

  /* Tri + ordre des colonnes de la composition (persisté) */
  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const [colOrder, setColOrder] = useState<string[]>(COMPO_COLS.map((c) => c.key));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COMPO_COL_STORAGE) || 'null');
      if (Array.isArray(saved)) {
        const keys = COMPO_COLS.map((c) => c.key);
        const valid = saved.filter((k: string) => keys.includes(k));
        setColOrder([...valid, ...keys.filter((k) => !valid.includes(k))]);
      }
    } catch { /* ignore */ }
  }, []);
  const onColDrop = (target: string) => {
    const src = dragRef.current; dragRef.current = null; setDragKey(null);
    if (!src || src === target) return;
    const next = [...colOrder];
    next.splice(next.indexOf(src), 1); next.splice(next.indexOf(target), 0, src);
    setColOrder(next);
    try { localStorage.setItem(COMPO_COL_STORAGE, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const orderedCompoCols = colOrder.map((k) => COMPO_COLS.find((c) => c.key === k)!).filter(Boolean);
  const rawComps = components.data ?? [];
  const comps = applySort(rawComps, sort, (c, key) => COMPO_COLS.find((col) => col.key === key)?.accessor(c));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button className="btn-ghost btn" onClick={() => router.push('/estimating/bibliotheque/ouvrages')} style={{ fontSize: 16 }}>←</button>
        <h1 style={{ margin: 0 }}>{isNew ? 'Nouvel ouvrage' : `${form.code} — ${form.label}`}</h1>
      </div>

      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
        {/* ─── Colonne principale ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Informations */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Informations</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Code"><input className="input" placeholder="A.1.2.1.1" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
              <Field label="Unité">
                <select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {(units.data ?? []).map((u) => <option key={u.id} value={u.abrev}>{u.abrev} — {u.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Désignation *"><input className="input" style={{ width: '100%' }} placeholder="Ex: Application deux couches de peinture…" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
            <Field label="Description"><textarea className="input" style={{ width: '100%', minHeight: 60, resize: 'vertical' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Catégorie"><input className="input" placeholder="Ex: Peinture" value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })} /></Field>
              <Field label="Lot">
                <select className="input" value={form.lotId} onChange={(e) => setForm({ ...form, lotId: e.target.value })}>
                  <option value="">— Aucun —</option>
                  {(lots.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} — {l.label}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button className="btn" disabled={!form.code || !form.label || save.isPending} onClick={() => { setErr(null); save.mutate(); }}>
                {save.isPending ? '…' : isNew ? 'Créer l\'ouvrage' : 'Enregistrer'}
              </button>
              {!isNew && (
                <button className="btn-danger btn" disabled={deleteOuvrage.isPending}
                  onClick={() => { setErr(null); if (confirm(`Supprimer l'ouvrage « ${form.code} » ? Cette action est définitive.`)) deleteOuvrage.mutate(); }}>
                  {deleteOuvrage.isPending ? '…' : 'Supprimer l\'ouvrage'}
                </button>
              )}
            </div>
          </div>

          {/* Composition */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Composition de l'ouvrage</h2>
              <button className="btn" disabled={isNew} onClick={() => setPickerOpen(true)} title={isNew ? 'Enregistrez d\'abord l\'ouvrage' : ''}>
                + Ajouter depuis la bibliothèque
              </button>
            </div>
            {isNew ? (
              <p className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>Enregistrez l'ouvrage pour composer sa décomposition.</p>
            ) : comps.length === 0 ? (
              <p className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>Aucun composant. Cliquez sur « Ajouter depuis la bibliothèque ».</p>
            ) : (
              <table className="grid" style={{ marginTop: 10 }}>
                <thead><tr>
                  <th style={{ width: 28 }}>#</th>
                  {orderedCompoCols.map((col) => (
                    <SortHeader key={col.key} label={col.label} colKey={col.key} sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} right={col.right}
                      draggable onDragStart={() => { dragRef.current = col.key; setDragKey(col.key); }} onDragOver={(e) => e.preventDefault()} onDrop={() => onColDrop(col.key)} dragging={dragKey === col.key} />
                  ))}
                  <th style={{ width: 36 }} />
                </tr></thead>
                <tbody>
                  {comps.map((c, i) => (
                    <ComponentRow key={c.id} c={c} index={i + 1} nbDec={nbDec} cols={orderedCompoCols}
                      onQty={(q) => updateComp.mutate({ cid: c.id, quantity: q })}
                      onPerte={(p) => updateComp.mutate({ cid: c.id, perte: p })}
                      onDelete={() => delComp.mutate(c.id)} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ─── Récapitulatif ─── */}
        <div className="card" style={{ position: 'sticky', top: 16 }}>
          <h2 style={{ marginTop: 0 }}>Récapitulatif</h2>
          <p className="muted" style={{ fontSize: 11, marginTop: 0 }}>Déboursé sec, recalculé à chaque modification.</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0', borderTop: '1px solid var(--border)' }}>
            <strong>Déboursé / {form.unit || 'U'}</strong>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--primary)' }}>{fmtEuro(debourse, nbDec)}</span>
          </div>
          <div style={{ background: 'var(--bg-alt, #f1f5f9)', borderRadius: 6, padding: '10px 12px', fontSize: 11, color: 'var(--muted)' }}>
            <strong style={{ color: 'var(--text)' }}>Formule prix de vente</strong><br />
            PV = Déboursé × FG × Bénéfice<br />
            Coefficients définis au niveau du devis.
          </div>
        </div>
      </div>

      {pickerOpen && (libIdParam || ouvrage.data?.libraryId) && (
        <ComponentPicker libId={(libIdParam || ouvrage.data!.libraryId)} token={token!} nbDec={nbDec}
          currentOuvrageId={ouvrageId}
          onPickResource={(r) => addComp.mutate(r)} onPickOuvrage={(o) => addSubOuvrage.mutate(o)}
          onClose={() => setPickerOpen(false)} isPending={addComp.isPending || addSubOuvrage.isPending} />
      )}
    </div>
  );
}

/* ─────────── ligne de composant (cellules dans l'ordre des colonnes, ratio/perte éditables) ─────────── */
function ComponentRow({ c, index, nbDec, cols, onQty, onPerte, onDelete }: {
  c: Component; index: number; nbDec: number; cols: CompoCol[];
  onQty: (v: string) => void; onPerte: (v: string) => void; onDelete: () => void;
}) {
  // valeurs nettoyées (sans zéros inutiles : 0.3000 → 0.3)
  const [qty, setQty] = useState(cleanNum(c.quantity) || '0');
  const [perte, setPerte] = useState(cleanNum(c.perte) || '0');
  useEffect(() => { setQty(cleanNum(c.quantity) || '0'); setPerte(cleanNum(c.perte) || '0'); }, [c.quantity, c.perte]);

  const clean = (v: string) => v.replace(',', '.').replace(/[^0-9.]/g, '');
  const pu = Number(c.childUnitCost ?? 0);
  const montant = (Number(qty) || 0) * (1 + (Number(perte) || 0) / 100) * pu;

  const cell = (key: string) => {
    switch (key) {
      case 'type': return <span className="badge" style={{ fontSize: 9 }}>{NAT[c.childNature ?? 'material'] ?? '—'}</span>;
      case 'code': return c.childCode ?? '—';
      case 'label': return c.childLabel ?? '—';
      case 'unit': return c.childUnit ?? '—';
      case 'ratio': return <input className="input" inputMode="decimal" style={{ width: 60, textAlign: 'right' }} value={qty}
        onChange={(e) => setQty(clean(e.target.value))} onBlur={() => qty !== cleanNum(c.quantity) && onQty(qty)} />;
      case 'perte': return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
          <input className="input" inputMode="decimal" style={{ width: 46, textAlign: 'right' }} value={perte}
            onChange={(e) => setPerte(clean(e.target.value))} onBlur={() => perte !== cleanNum(c.perte) && onPerte(perte)} />
          <span className="muted" style={{ fontSize: 11 }}>%</span>
        </span>
      );
      case 'pu': return fmtEuro(pu, nbDec);
      case 'montant': return <strong>{fmtEuro(montant, nbDec)}</strong>;
      default: return null;
    }
  };

  return (
    <tr>
      <td className="muted">{index}</td>
      {cols.map((col) => (
        <td key={col.key} className={col.key === 'code' ? 'code-cell' : (col.key === 'unit' || col.key === 'pu') ? 'muted' : undefined}
          style={{ textAlign: col.right ? 'right' : 'left' }}>
          {cell(col.key)}
        </td>
      ))}
      <td><button className="btn-danger btn" onClick={onDelete}>✕</button></td>
    </tr>
  );
}

/* ─────────── modale picker : cheminement Lot → Nature → Famille → Ressources, ou Ouvrages ─────────── */
interface FamillePick { id: string; code: string; label: string; lot_id: string | null; nature: string }
interface LotPick { id: string; code: string; label: string }
interface OuvragePick { id: string; code: string; label: string; unit: string; debourse: string }

const NAT_OPTS = [
  { v: 'material', l: 'Matériaux' }, { v: 'labor', l: "Main d'œuvre" },
  { v: 'equipment', l: 'Matériel' }, { v: 'subcontract', l: 'Sous-traitance' },
];

function ComponentPicker({ libId, token, nbDec, currentOuvrageId, onPickResource, onPickOuvrage, onClose, isPending }: {
  libId: string; token: string; nbDec: number; currentOuvrageId: string;
  onPickResource: (r: ResourcePick) => void; onPickOuvrage: (o: OuvragePick) => void;
  onClose: () => void; isPending: boolean;
}) {
  const [tab, setTab] = useState<'resource' | 'ouvrage'>('resource');
  const [lotId, setLotId] = useState('');
  const [nature, setNature] = useState('');
  const [familleId, setFamilleId] = useState('');
  const [search, setSearch] = useState('');

  const lots = useQuery({ queryKey: ['params-lots'], queryFn: () => apiFetch<LotPick[]>('/params/lots', { token }) });
  const familles = useQuery({ queryKey: ['params-familles'], queryFn: () => apiFetch<FamillePick[]>('/params/familles', { token }) });

  // Familles filtrées par lot + nature (cheminement)
  const familleOptions = (familles.data ?? []).filter((f) =>
    (!lotId || f.lot_id === lotId) && (!nature || f.nature === nature));

  // Ressources : on ne charge qu'après un filtre (famille OU recherche) pour éviter de tout tirer
  const hasFilter = Boolean(familleId || search.trim() || nature || lotId);
  const resQuery = useQuery({
    queryKey: ['picker-resources', libId, familleId, nature, lotId, search],
    enabled: Boolean(libId && tab === 'resource' && hasFilter),
    queryFn: () => apiFetch<{ rows: ResourcePick[]; total: number }>(
      `/libraries/${libId}/resources?pageSize=500`
      + `${familleId ? `&familleId=${familleId}` : ''}${lotId ? `&lotId=${lotId}` : ''}`
      + `${nature ? `&nature=${nature}` : ''}&search=${encodeURIComponent(search)}`,
      { token }),
  });
  const ouvQuery = useQuery({
    queryKey: ['picker-ouvrages', libId, search],
    enabled: Boolean(libId && tab === 'ouvrage'),
    queryFn: () => apiFetch<{ rows: OuvragePick[] }>(`/libraries/${libId}/ouvrages?pageSize=500&search=${encodeURIComponent(search)}`, { token }),
  });

  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const onSort = (k: string) => setSort((s) => nextSort(s, k));
  const acc = (row: ResourcePick | OuvragePick, k: string) => {
    const v = (row as unknown as Record<string, unknown>)[k];
    return (k === 'unitCost' || k === 'debourse') ? Number(v) : v;
  };
  const resRows = applySort(resQuery.data?.rows ?? [], sort, acc);
  const ouvRows = applySort((ouvQuery.data?.rows ?? []).filter((o) => o.id !== currentOuvrageId), sort, acc);
  const selStyle: React.CSSProperties = { padding: '6px 8px', fontSize: 12 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', width: 720, maxWidth: '100%', boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <strong style={{ fontSize: 15 }}>Ajouter un composant</strong>
          <button className="btn-ghost btn" onClick={onClose} style={{ fontSize: 16 }}>✕</button>
        </div>

        {/* Onglets Ressource / Sous-ouvrage */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 14 }}>
          {[{ v: 'resource', l: 'Ressources' }, { v: 'ouvrage', l: 'Sous-ouvrages' }].map((t) => (
            <button key={t.v} onClick={() => setTab(t.v as 'resource' | 'ouvrage')}
              style={{ background: 'none', border: 'none', padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                color: tab === t.v ? 'var(--primary)' : 'var(--muted)', borderBottom: tab === t.v ? '2px solid var(--primary)' : '2px solid transparent', marginBottom: -2 }}>
              {t.l}
            </button>
          ))}
        </div>

        {tab === 'resource' ? (
          <>
            {/* Cheminement Lot → Nature → Famille */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <select className="input" style={selStyle} value={lotId} onChange={(e) => { setLotId(e.target.value); setFamilleId(''); }}>
                <option value="">Lot : tous</option>
                {(lots.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} — {l.label}</option>)}
              </select>
              <select className="input" style={selStyle} value={nature} onChange={(e) => { setNature(e.target.value); setFamilleId(''); }}>
                <option value="">Nature : toutes</option>
                {NAT_OPTS.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
              </select>
              <select className="input" style={selStyle} value={familleId} onChange={(e) => setFamilleId(e.target.value)}>
                <option value="">Famille : toutes</option>
                {familleOptions.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.label}</option>)}
              </select>
              <input className="input" style={{ ...selStyle, flex: 1, minWidth: 160 }} placeholder="Rechercher code / libellé…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {!hasFilter ? (
              <p className="muted" style={{ textAlign: 'center', padding: '20px 0' }}>
                Choisissez un lot, une nature, une famille ou tapez une recherche pour afficher les ressources.
              </p>
            ) : resRows.length === 0 ? (
              <p className="muted" style={{ textAlign: 'center', padding: '20px 0' }}>{resQuery.isLoading ? 'Chargement…' : 'Aucune ressource.'}</p>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 10.5, margin: '0 0 6px' }}>{resQuery.data?.total ?? resRows.length} ressource(s)</p>
                <table className="grid">
                  <thead><tr>
                    <SortHeader label="Code" colKey="code" sort={sort} onSort={onSort} />
                    <SortHeader label="Désignation" colKey="label" sort={sort} onSort={onSort} />
                    <SortHeader label="Unité" colKey="unit" sort={sort} onSort={onSort} />
                    <SortHeader label="PU déb." colKey="unitCost" sort={sort} onSort={onSort} right />
                    <th style={{ width: 60 }} />
                  </tr></thead>
                  <tbody>
                    {resRows.map((r) => (
                      <tr key={r.id}>
                        <td className="code-cell">{r.code}</td><td>{r.label}</td><td className="muted">{r.unit}</td>
                        <td style={{ textAlign: 'right' }}>{fmtEuro(r.unitCost, nbDec)}</td>
                        <td><button className="btn" disabled={isPending} onClick={() => onPickResource(r)}>+ Ajouter</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        ) : (
          <>
            <input className="input" style={{ width: '100%', marginBottom: 10 }} placeholder="Rechercher un ouvrage…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {ouvRows.length === 0 ? <p className="muted" style={{ textAlign: 'center', padding: '20px 0' }}>Aucun autre ouvrage.</p> : (
              <table className="grid">
                <thead><tr>
                  <SortHeader label="Code" colKey="code" sort={sort} onSort={onSort} />
                  <SortHeader label="Désignation" colKey="label" sort={sort} onSort={onSort} />
                  <SortHeader label="Unité" colKey="unit" sort={sort} onSort={onSort} />
                  <SortHeader label="Déboursé" colKey="debourse" sort={sort} onSort={onSort} right />
                  <th style={{ width: 60 }} />
                </tr></thead>
                <tbody>
                  {ouvRows.map((o) => (
                    <tr key={o.id}>
                      <td className="code-cell">{o.code}</td><td>{o.label}</td><td className="muted">{o.unit}</td>
                      <td style={{ textAlign: 'right' }}>{fmtEuro(o.debourse, nbDec)}</td>
                      <td><button className="btn" disabled={isPending} onClick={() => onPickOuvrage(o)}>+ Ajouter</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
