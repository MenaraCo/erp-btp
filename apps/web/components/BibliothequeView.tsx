'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';
import { ResourceModal, FullResource } from './ResourceModal';

interface Library { id: string; code: string; name: string }
type Resource = FullResource;
interface Ouvrage { id: string; code: string; label: string; unit: string; debourse: string }
interface Page<T> { rows: T[]; total: number }

const NATURES = [
  { v: 'material', l: 'Matériaux' },
  { v: 'labor', l: "Main d'œuvre" },
  { v: 'equipment', l: 'Matériel' },
  { v: 'subcontract', l: 'Sous-traitance' },
];

export function BibliothequeView({ section = 'both' }: { section?: 'both' | 'ressources' | 'ouvrages' }) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [libId, setLibId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [natFilter, setNatFilter] = useState('');

  const libs = useQuery({
    queryKey: ['libraries'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Page<Library>>('/libraries?pageSize=100', { token }),
  });
  const resources = useQuery({
    queryKey: ['resources', libId],
    enabled: Boolean(token && libId),
    queryFn: () => apiFetch<Page<Resource>>(`/libraries/${libId}/resources?pageSize=2000`, { token }),
  });
  const ouvrages = useQuery({
    queryKey: ['ouvrages', libId],
    enabled: Boolean(token && libId && section !== 'ressources'),
    queryFn: () => apiFetch<Page<Ouvrage>>(`/libraries/${libId}/ouvrages?pageSize=2000`, { token }),
  });

  const [libForm, setLibForm] = useState({ code: '', name: '' });
  const [ouvForm, setOuvForm] = useState({ code: '', label: '', unit: '' });
  // Modale ressource : null = fermée, 'new' = création, sinon ressource à éditer
  const [resModal, setResModal] = useState<'new' | Resource | null>(null);

  const createLib = useMutation({
    mutationFn: () => apiFetch<Library>('/libraries', { method: 'POST', body: libForm, token }),
    onSuccess: (lib) => { qc.invalidateQueries({ queryKey: ['libraries'] }); setLibForm({ code: '', name: '' }); setLibId(lib.id); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });
  const createOuv = useMutation({
    mutationFn: () => apiFetch(`/libraries/${libId}/ouvrages`, { method: 'POST', body: ouvForm, token }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ouvrages', libId] }); setOuvForm({ code: '', label: '', unit: '' }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const title = section === 'ressources' ? 'Bibliothèque — Ressources'
    : section === 'ouvrages' ? 'Bibliothèque — Ouvrages' : 'Bibliothèque d’étude de prix';
  const filteredRes = (resources.data?.rows ?? []).filter((r) => !natFilter || r.nature === natFilter);

  return (
    <div>
      <h1>{title}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Sélectionnez une bibliothèque, puis gérez ses {section === 'ouvrages' ? 'ouvrages composés' : section === 'ressources' ? 'ressources' : 'ressources et ouvrages'}.
      </p>
      {err && <div className="error">{err}</div>}

      <div className="card" style={{ marginTop: 12 }}>
        <h2>Bibliothèques</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {(libs.data?.rows ?? []).map((l) => (
            <button key={l.id} className={l.id === libId ? 'btn' : 'btn-secondary'} onClick={() => setLibId(l.id)}>
              {l.code} — {l.name}
            </button>
          ))}
          {libs.data && libs.data.rows.length === 0 && <span className="muted">Aucune bibliothèque.</span>}
        </div>
        <form style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}
          onSubmit={(e) => { e.preventDefault(); setErr(null); if (libForm.code && libForm.name) createLib.mutate(); }}>
          <Field label="Code"><input value={libForm.code} onChange={(e) => setLibForm({ ...libForm, code: e.target.value })} /></Field>
          <Field label="Nom"><input value={libForm.name} onChange={(e) => setLibForm({ ...libForm, name: e.target.value })} /></Field>
          <button className="btn" type="submit">+ Bibliothèque</button>
        </form>
      </div>

      {libId && section !== 'ouvrages' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Ressources ({filteredRes.length})</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button className={natFilter === '' ? 'btn' : 'btn-ghost'} style={{ padding: '3px 8px' }} onClick={() => setNatFilter('')}>Tous</button>
                {NATURES.map((n) => (
                  <button key={n.v} className={natFilter === n.v ? 'btn' : 'btn-ghost'} style={{ padding: '3px 8px' }} onClick={() => setNatFilter(n.v)}>{n.l}</button>
                ))}
              </div>
              <button className="btn" onClick={() => setResModal('new')}>+ Nouvelle ressource</button>
            </div>
          </div>
          {filteredRes.length > 0 ? (
            <table className="grid" style={{ marginTop: 10 }}>
              <thead><tr><th>Code</th><th>Libellé</th><th>Unité</th><th>Nature</th><th style={{ textAlign: 'right' }}>Déboursé U.</th><th>Unité achat</th><th style={{ textAlign: 'right' }}>Coeff</th></tr></thead>
              <tbody>
                {filteredRes.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setResModal(r)} title="Modifier la ressource">
                    <td className="code-cell">{r.code}</td><td>{r.label}</td><td>{r.unit}</td>
                    <td className="muted">{NATURES.find((n) => n.v === r.nature)?.l ?? r.nature}</td>
                    <td style={{ textAlign: 'right' }}>{euro(r.unitCost)}</td>
                    <td className="muted">{r.uniteAchat ?? '—'}</td>
                    <td style={{ textAlign: 'right' }} className="muted">{r.coeffConversion ? Number(r.coeffConversion) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>Aucune ressource. Cliquez sur « + Nouvelle ressource ».</p>
          )}
        </div>
      )}

      {libId && resModal && (
        <ResourceModal
          libId={libId}
          resource={resModal === 'new' ? null : resModal}
          onClose={() => setResModal(null)}
        />
      )}

      {libId && section !== 'ressources' && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Ouvrages composés {ouvrages.data ? `(${ouvrages.data.total})` : ''}</h2>
          <p className="muted" style={{ marginTop: 0 }}>Composez un ouvrage à partir de ressources : son déboursé se met à jour.</p>
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
          <form style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}
            onSubmit={(e) => { e.preventDefault(); setErr(null); if (ouvForm.code && ouvForm.label && ouvForm.unit) createOuv.mutate(); }}>
            <Field label="Code"><input value={ouvForm.code} onChange={(e) => setOuvForm({ ...ouvForm, code: e.target.value })} /></Field>
            <Field label="Libellé"><input value={ouvForm.label} onChange={(e) => setOuvForm({ ...ouvForm, label: e.target.value })} /></Field>
            <Field label="Unité"><input style={{ width: 64 }} value={ouvForm.unit} onChange={(e) => setOuvForm({ ...ouvForm, unit: e.target.value })} /></Field>
            <button className="btn" type="submit">+ Ouvrage</button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field" style={{ marginBottom: 0 }}><label>{label}</label>{children}</div>;
}

function OuvrageRow({ ouvrage, resources, libId }: { ouvrage: Ouvrage; resources: Resource[]; libId: string }) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [resId, setResId] = useState('');
  const [qty, setQty] = useState('');

  const addComp = useMutation({
    mutationFn: () => apiFetch(`/ouvrages/${ouvrage.id}/components`, { method: 'POST', body: { kind: 'resource', childResourceId: resId, quantity: qty || '0' }, token }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ouvrages', libId] }); setResId(''); setQty(''); },
  });

  return (
    <tr>
      <td className="code-cell">{ouvrage.code}</td>
      <td>{ouvrage.label}</td>
      <td>{ouvrage.unit}</td>
      <td style={{ textAlign: 'right' }}>{euro(ouvrage.debourse)}</td>
      <td>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={resId} onChange={(e) => setResId(e.target.value)}>
            <option value="">— ressource —</option>
            {resources.map((r) => <option key={r.id} value={r.id}>{r.code} ({euro(r.unitCost)})</option>)}
          </select>
          <input style={{ width: 60 }} placeholder="qté" value={qty} onChange={(e) => setQty(e.target.value)} />
          <button className="link" disabled={!resId || !qty || addComp.isPending} onClick={() => addComp.mutate()}>+ ajouter</button>
        </div>
      </td>
    </tr>
  );
}
