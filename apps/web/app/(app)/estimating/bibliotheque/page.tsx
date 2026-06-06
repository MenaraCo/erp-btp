'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';

interface Library {
  id: string;
  code: string;
  name: string;
}
interface Resource {
  id: string;
  code: string;
  label: string;
  unit: string;
  nature: string;
  unit_cost: string;
}
interface Ouvrage {
  id: string;
  code: string;
  label: string;
  unit: string;
  debourse: string;
}
interface Page<T> {
  rows: T[];
  total: number;
}

const NATURES = [
  { v: 'material', l: 'Matériaux' },
  { v: 'labor', l: "Main d'œuvre" },
  { v: 'equipment', l: 'Matériel' },
  { v: 'subcontract', l: 'Sous-traitance' },
];

export default function BibliothequePage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [libId, setLibId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const libs = useQuery({
    queryKey: ['libraries'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Page<Library>>('/libraries?pageSize=100', { token }),
  });
  const resources = useQuery({
    queryKey: ['resources', libId],
    enabled: Boolean(token && libId),
    queryFn: () => apiFetch<Page<Resource>>(`/libraries/${libId}/resources?pageSize=200`, { token }),
  });
  const ouvrages = useQuery({
    queryKey: ['ouvrages', libId],
    enabled: Boolean(token && libId),
    queryFn: () => apiFetch<Page<Ouvrage>>(`/libraries/${libId}/ouvrages?pageSize=200`, { token }),
  });

  // --- forms ---
  const [libForm, setLibForm] = useState({ code: '', name: '' });
  const [resForm, setResForm] = useState({ code: '', label: '', unit: '', nature: 'material', unitCost: '', uniteAchat: '', coeffConversion: '', prixPublic: '' });
  const [ouvForm, setOuvForm] = useState({ code: '', label: '', unit: '' });

  const createLib = useMutation({
    mutationFn: () => apiFetch<Library>('/libraries', { method: 'POST', body: libForm, token }),
    onSuccess: (lib) => {
      qc.invalidateQueries({ queryKey: ['libraries'] });
      setLibForm({ code: '', name: '' });
      setLibId(lib.id);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });
  const createRes = useMutation({
    mutationFn: () =>
      apiFetch(`/libraries/${libId}/resources`, {
        method: 'POST',
        body: {
          code: resForm.code,
          label: resForm.label,
          unit: resForm.unit,
          nature: resForm.nature,
          unitCost: resForm.unitCost || '0',
          uniteAchat: resForm.uniteAchat || null,
          coeffConversion: resForm.coeffConversion || null,
          prixPublic: resForm.prixPublic || null,
        },
        token,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources', libId] });
      setResForm({ code: '', label: '', unit: '', nature: 'material', unitCost: '', uniteAchat: '', coeffConversion: '', prixPublic: '' });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });
  const createOuv = useMutation({
    mutationFn: () => apiFetch(`/libraries/${libId}/ouvrages`, { method: 'POST', body: ouvForm, token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ouvrages', libId] });
      setOuvForm({ code: '', label: '', unit: '' });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  return (
    <div>
      <h1>Bibliothèque d'étude de prix</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Créez vos ressources et composez des ouvrages : le <strong>déboursé</strong> se recalcule
        automatiquement. Ces ouvrages servent ensuite à constituer un devis.
      </p>
      {err && <div className="error">{err}</div>}

      <div className="card" style={{ marginTop: 12 }}>
        <h2>Bibliothèques</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {(libs.data?.rows ?? []).map((l) => (
            <button
              key={l.id}
              className={l.id === libId ? 'btn' : 'link'}
              onClick={() => setLibId(l.id)}
            >
              {l.code} — {l.name}
            </button>
          ))}
          {libs.data && libs.data.rows.length === 0 && <span className="muted">Aucune bibliothèque.</span>}
        </div>
        <form
          style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            setErr(null);
            if (libForm.code && libForm.name) createLib.mutate();
          }}
        >
          <Field label="Code"><input value={libForm.code} onChange={(e) => setLibForm({ ...libForm, code: e.target.value })} /></Field>
          <Field label="Nom"><input value={libForm.name} onChange={(e) => setLibForm({ ...libForm, name: e.target.value })} /></Field>
          <button className="btn" type="submit">+ Bibliothèque</button>
        </form>
      </div>

      {libId && (
        <>
          <div id="ressources" className="card" style={{ marginTop: 16, scrollMarginTop: 16 }}>
            <h2>Ressources {resources.data ? `(${resources.data.total})` : ''}</h2>
            {resources.data && resources.data.rows.length > 0 && (
              <table className="grid">
                <thead><tr><th>Code</th><th>Libellé</th><th>Unité</th><th>Nature</th><th style={{ textAlign: 'right' }}>Déboursé U.</th></tr></thead>
                <tbody>
                  {resources.data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.code}</td><td>{r.label}</td><td>{r.unit}</td>
                      <td className="muted">{NATURES.find((n) => n.v === r.nature)?.l ?? r.nature}</td>
                      <td style={{ textAlign: 'right' }}>{euro(r.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form
              style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}
              onSubmit={(e) => {
                e.preventDefault();
                setErr(null);
                if (resForm.code && resForm.label && resForm.unit) createRes.mutate();
              }}
            >
              <Field label="Code"><input value={resForm.code} onChange={(e) => setResForm({ ...resForm, code: e.target.value })} /></Field>
              <Field label="Libellé"><input value={resForm.label} onChange={(e) => setResForm({ ...resForm, label: e.target.value })} /></Field>
              <Field label="Unité"><input style={{ width: 70 }} value={resForm.unit} onChange={(e) => setResForm({ ...resForm, unit: e.target.value })} /></Field>
              <Field label="Nature">
                <select value={resForm.nature} onChange={(e) => setResForm({ ...resForm, nature: e.target.value })}>
                  {NATURES.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
                </select>
              </Field>
              <Field label="Déboursé U."><input style={{ width: 80 }} value={resForm.unitCost} onChange={(e) => setResForm({ ...resForm, unitCost: e.target.value })} /></Field>
              <Field label="Unité achat"><input style={{ width: 80 }} placeholder="palette" value={resForm.uniteAchat} onChange={(e) => setResForm({ ...resForm, uniteAchat: e.target.value })} /></Field>
              <Field label="Coeff conv."><input style={{ width: 70 }} placeholder="40" title="1 unité d'achat = X unités d'emploi" value={resForm.coeffConversion} onChange={(e) => setResForm({ ...resForm, coeffConversion: e.target.value })} /></Field>
              <Field label="Prix public"><input style={{ width: 80 }} placeholder="par unité achat" value={resForm.prixPublic} onChange={(e) => setResForm({ ...resForm, prixPublic: e.target.value })} /></Field>
              <button className="btn" type="submit">+ Ressource</button>
            </form>
          </div>

          <div id="ouvrages" className="card" style={{ marginTop: 16, scrollMarginTop: 16 }}>
            <h2>Ouvrages composés {ouvrages.data ? `(${ouvrages.data.total})` : ''}</h2>
            <p className="muted" style={{ marginTop: 0 }}>Ajoutez des ressources à un ouvrage : son déboursé se met à jour.</p>
            {ouvrages.data && ouvrages.data.rows.length > 0 && (
              <table className="grid">
                <thead><tr><th>Code</th><th>Libellé</th><th>Unité</th><th style={{ textAlign: 'right' }}>Déboursé</th><th>Composer</th></tr></thead>
                <tbody>
                  {ouvrages.data.rows.map((o) => (
                    <OuvrageRow key={o.id} ouvrage={o} resources={resources.data?.rows ?? []} libId={libId} />
                  ))}
                </tbody>
              </table>
            )}
            <form
              style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}
              onSubmit={(e) => {
                e.preventDefault();
                setErr(null);
                if (ouvForm.code && ouvForm.label && ouvForm.unit) createOuv.mutate();
              }}
            >
              <Field label="Code"><input value={ouvForm.code} onChange={(e) => setOuvForm({ ...ouvForm, code: e.target.value })} /></Field>
              <Field label="Libellé"><input value={ouvForm.label} onChange={(e) => setOuvForm({ ...ouvForm, label: e.target.value })} /></Field>
              <Field label="Unité"><input style={{ width: 70 }} value={ouvForm.unit} onChange={(e) => setOuvForm({ ...ouvForm, unit: e.target.value })} /></Field>
              <button className="btn" type="submit">+ Ouvrage</button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

function OuvrageRow({ ouvrage, resources, libId }: { ouvrage: Ouvrage; resources: Resource[]; libId: string }) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [resId, setResId] = useState('');
  const [qty, setQty] = useState('');

  const addComp = useMutation({
    mutationFn: () =>
      apiFetch(`/ouvrages/${ouvrage.id}/components`, {
        method: 'POST',
        body: { kind: 'resource', childResourceId: resId, quantity: qty || '0' },
        token,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ouvrages', libId] });
      setResId('');
      setQty('');
    },
  });

  return (
    <tr>
      <td>{ouvrage.code}</td>
      <td>{ouvrage.label}</td>
      <td>{ouvrage.unit}</td>
      <td style={{ textAlign: 'right' }}>{euro(ouvrage.debourse)}</td>
      <td>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={resId} onChange={(e) => setResId(e.target.value)}>
            <option value="">— ressource —</option>
            {resources.map((r) => <option key={r.id} value={r.id}>{r.code} ({euro(r.unit_cost)})</option>)}
          </select>
          <input style={{ width: 70 }} placeholder="qté" value={qty} onChange={(e) => setQty(e.target.value)} />
          <button
            className="link"
            disabled={!resId || !qty || addComp.isPending}
            onClick={() => addComp.mutate()}
          >
            + ajouter
          </button>
        </div>
      </td>
    </tr>
  );
}
