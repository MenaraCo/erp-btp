'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { usePreferences, fmtEuro } from '@/lib/preferences';

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
  const comps = components.data ?? [];

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
            <div style={{ marginTop: 12 }}>
              <button className="btn" disabled={!form.code || !form.label || save.isPending} onClick={() => { setErr(null); save.mutate(); }}>
                {save.isPending ? '…' : isNew ? 'Créer l\'ouvrage' : 'Enregistrer'}
              </button>
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
                  <th style={{ width: 28 }}>#</th><th>Type</th><th>Code</th><th>Désignation</th><th>Unité</th>
                  <th style={{ textAlign: 'right' }}>Ratio</th><th style={{ textAlign: 'right' }}>Perte %</th>
                  <th style={{ textAlign: 'right' }}>PU déb.</th><th style={{ textAlign: 'right' }}>Montant</th><th style={{ width: 36 }} />
                </tr></thead>
                <tbody>
                  {comps.map((c, i) => (
                    <ComponentRow key={c.id} c={c} index={i + 1} nbDec={nbDec}
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
        <ResourcePicker libId={(libIdParam || ouvrage.data!.libraryId)} token={token!} nbDec={nbDec}
          onPick={(r) => addComp.mutate(r)} onClose={() => setPickerOpen(false)} isPending={addComp.isPending} />
      )}
    </div>
  );
}

/* ─────────── ligne de composant (ratio/perte éditables) ─────────── */
function ComponentRow({ c, index, nbDec, onQty, onPerte, onDelete }: {
  c: Component; index: number; nbDec: number;
  onQty: (v: string) => void; onPerte: (v: string) => void; onDelete: () => void;
}) {
  const [qty, setQty] = useState(c.quantity ?? '0');
  const [perte, setPerte] = useState(c.perte ?? '0');
  useEffect(() => { setQty(c.quantity ?? '0'); setPerte(c.perte ?? '0'); }, [c.quantity, c.perte]);

  const pu = Number(c.childUnitCost ?? 0);
  const ratio = Number(qty) || 0;
  const pertePct = Number(perte) || 0;
  const montant = ratio * (1 + pertePct / 100) * pu;
  const clean = (v: string) => v.replace(',', '.').replace(/[^0-9.]/g, '');

  return (
    <tr>
      <td className="muted">{index}</td>
      <td><span className="badge" style={{ fontSize: 9 }}>{NAT[c.childNature ?? 'material'] ?? '—'}</span></td>
      <td className="code-cell">{c.childCode ?? '—'}</td>
      <td>{c.childLabel ?? '—'}</td>
      <td className="muted">{c.childUnit ?? '—'}</td>
      <td style={{ textAlign: 'right' }}>
        <input className="input" inputMode="decimal" style={{ width: 60, textAlign: 'right' }} value={qty}
          onChange={(e) => setQty(clean(e.target.value))} onBlur={() => qty !== (c.quantity ?? '0') && onQty(qty)} />
      </td>
      <td style={{ textAlign: 'right' }}>
        <input className="input" inputMode="decimal" style={{ width: 50, textAlign: 'right' }} value={perte}
          onChange={(e) => setPerte(clean(e.target.value))} onBlur={() => perte !== (c.perte ?? '0') && onPerte(perte)} />
      </td>
      <td style={{ textAlign: 'right' }} className="muted">{fmtEuro(pu, nbDec)}</td>
      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtEuro(montant, nbDec)}</td>
      <td><button className="btn-danger btn" onClick={onDelete}>✕</button></td>
    </tr>
  );
}

/* ─────────── modale picker de ressources ─────────── */
function ResourcePicker({ libId, token, nbDec, onPick, onClose, isPending }: {
  libId: string; token: string; nbDec: number;
  onPick: (r: ResourcePick) => void; onClose: () => void; isPending: boolean;
}) {
  const [search, setSearch] = useState('');
  const list = useQuery({
    queryKey: ['picker-resources', libId, search],
    queryFn: () => apiFetch<{ rows: ResourcePick[] }>(`/libraries/${libId}/resources?pageSize=50&search=${encodeURIComponent(search)}`, { token }),
    enabled: Boolean(libId),
  });
  const rows = list.data?.rows ?? [];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', width: 640, maxWidth: '100%', boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <strong style={{ fontSize: 15 }}>Ajouter une ressource</strong>
          <button className="btn-ghost btn" onClick={onClose} style={{ fontSize: 16 }}>✕</button>
        </div>
        <input className="input" autoFocus placeholder="Rechercher code / libellé…" style={{ width: '100%', marginBottom: 12 }} value={search} onChange={(e) => setSearch(e.target.value)} />
        {rows.length === 0 ? <p className="muted">Aucune ressource.</p> : (
          <table className="grid">
            <thead><tr><th>Code</th><th>Désignation</th><th>Unité</th><th style={{ textAlign: 'right' }}>PU déb.</th><th style={{ width: 60 }} /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="code-cell">{r.code}</td><td>{r.label}</td><td className="muted">{r.unit}</td>
                  <td style={{ textAlign: 'right' }}>{fmtEuro(r.unitCost, nbDec)}</td>
                  <td><button className="btn" disabled={isPending} onClick={() => onPick(r)}>+ Ajouter</button></td>
                </tr>
              ))}
            </tbody>
          </table>
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
