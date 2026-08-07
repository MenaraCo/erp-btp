'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { usePreferences, fmtEuro } from '@/lib/preferences';
import { usePermissions } from '@/lib/capabilities';
import { ResourceModal, FullResource } from './ResourceModal';
import { SortHeader, SortState, nextSort, applySort } from './SortHeader';

interface Library { id: string; code: string; name: string }
type Resource = FullResource & {
  familleCode?: string | null; familleLabel?: string | null;
  codeAnalytiqueCode?: string | null; codeAnalytiqueLabel?: string | null;
  supplierName?: string | null;
};
interface Ouvrage { id: string; code: string; label: string; unit: string; debourse: string; categorie?: string | null }
interface Page<T> { rows: T[]; total: number }

/* Colonnes du tableau ressources : clé, libellé, tri serveur, rendu, alignement */
interface ResColumn {
  key: string; label: string; sort: string;
  render: (r: Resource, nbDec: number) => React.ReactNode;
  right?: boolean; cls?: string;
}
const RES_COLUMNS: ResColumn[] = [
  { key: 'code', label: 'Code', sort: 'code', render: (r) => r.code, cls: 'code-cell' },
  { key: 'label', label: 'Désignation', sort: 'label', render: (r) => r.label },
  { key: 'famille', label: 'Famille', sort: 'familleCode', render: (r) => r.familleCode ? `${r.familleCode}` : '—' },
  { key: 'nature', label: 'Nature', sort: 'nature', render: (r) => NATURES.find((n) => n.v === r.nature)?.l ?? r.nature },
  { key: 'unit', label: 'Unité', sort: 'unit', render: (r) => r.unit },
  { key: 'unitCost', label: 'PU Débours', sort: 'unitCost', render: (r, d) => fmtEuro(r.unitCost, d), right: true },
  { key: 'codeAna', label: 'Code ana.', sort: 'codeAnalytiqueCode', render: (r) => r.codeAnalytiqueCode ?? '—' },
  { key: 'supplier', label: 'Distributeur', sort: 'supplierName', render: (r) => r.supplierName ?? '—' },
  { key: 'uniteAchat', label: 'U. achat', sort: 'uniteAchat', render: (r) => r.uniteAchat ?? '—' },
];
const RES_COL_STORAGE = 'erp.bibliotheque.resColOrder';

const NATURES = [
  { v: 'material', l: 'Matériaux' },
  { v: 'labor', l: "Main d'œuvre" },
  { v: 'equipment', l: 'Matériel' },
  { v: 'subcontract', l: 'Sous-traitance' },
];

const PAGE_SIZE = 50;

export function BibliothequeView({ section = 'both' }: { section?: 'both' | 'ressources' | 'ouvrages' }) {
  const { token } = useAuth();
  const { nb_decimales: nbDec } = usePreferences();
  // Un rôle de lecture (Direction) ne se voit pas proposer de créer ni de modifier : le serveur
  // refuserait de toute façon.
  const { canOrLoading } = usePermissions();
  const peutEcrire = canOrLoading('estimating.devis.write');
  const qc = useQueryClient();
  const router = useRouter();
  const [libId, setLibId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [natFilter, setNatFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  // Ordre des colonnes (déplaçables), persisté en localStorage
  const [colOrder, setColOrder] = useState<string[]>(RES_COLUMNS.map((c) => c.key));
  const [dragKey, setDragKey] = useState<string | null>(null); // visuel uniquement
  const dragKeyRef = useRef<string | null>(null); // source fiable (synchrone)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RES_COL_STORAGE) || 'null');
      if (Array.isArray(saved)) {
        const keys = RES_COLUMNS.map((c) => c.key);
        const valid = saved.filter((k: string) => keys.includes(k));
        const merged = [...valid, ...keys.filter((k) => !valid.includes(k))];
        if (merged.length) setColOrder(merged);
      }
    } catch { /* ignore */ }
  }, []);

  const persistOrder = (order: string[]) => {
    setColOrder(order);
    try { localStorage.setItem(RES_COL_STORAGE, JSON.stringify(order)); } catch { /* ignore */ }
  };
  const onColDragStart = (key: string) => { dragKeyRef.current = key; setDragKey(key); };
  const onColDrop = (targetKey: string) => {
    const src = dragKeyRef.current;
    dragKeyRef.current = null;
    setDragKey(null);
    if (!src || src === targetKey) return;
    const next = [...colOrder];
    next.splice(next.indexOf(src), 1);
    next.splice(next.indexOf(targetKey), 0, src);
    persistOrder(next);
  };
  const orderedCols = colOrder.map((k) => RES_COLUMNS.find((c) => c.key === k)!).filter(Boolean);
  const doSort = (key: string) => { setSort((s) => nextSort(s, key)); setPage(1); };

  const libs = useQuery({
    queryKey: ['libraries'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Page<Library>>('/libraries?pageSize=100', { token }),
  });
  // Liste paginée (recherche + filtre nature + tri côté serveur → scale à des milliers d'articles)
  const resources = useQuery({
    queryKey: ['resources', libId, page, search, natFilter, sort.key, sort.dir],
    enabled: Boolean(token && libId),
    queryFn: () => apiFetch<Page<Resource>>(
      `/libraries/${libId}/resources?page=${page}&pageSize=${PAGE_SIZE}`
      + `&search=${encodeURIComponent(search)}${natFilter ? `&nature=${natFilter}` : ''}`
      + `${sort.key ? `&sort=${sort.key}&dir=${sort.dir}` : ''}`,
      { token },
    ),
  });
  const ouvrages = useQuery({
    queryKey: ['ouvrages', libId],
    enabled: Boolean(token && libId && section !== 'ressources'),
    queryFn: () => apiFetch<Page<Ouvrage>>(`/libraries/${libId}/ouvrages?pageSize=2000`, { token }),
  });

  const [libForm, setLibForm] = useState({ code: '', name: '' });
  const [ouvSort, setOuvSort] = useState<SortState>({ key: null, dir: 'asc' });
  // Modale ressource : null = fermée, 'new' = création, sinon ressource à éditer
  const [resModal, setResModal] = useState<'new' | Resource | null>(null);

  const createLib = useMutation({
    mutationFn: () => apiFetch<Library>('/libraries', { method: 'POST', body: libForm, token }),
    onSuccess: (lib) => { qc.invalidateQueries({ queryKey: ['libraries'] }); setLibForm({ code: '', name: '' }); setLibId(lib.id); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const title = section === 'ressources' ? 'Bibliothèque — Ressources'
    : section === 'ouvrages' ? 'Bibliothèque — Ouvrages' : 'Bibliothèque d’étude de prix';
  const resRows = resources.data?.rows ?? [];
  const resTotal = resources.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(resTotal / PAGE_SIZE));
  // Reset page quand on change le filtre/recherche
  const applyFilter = (n: string) => { setNatFilter(n); setPage(1); };
  const applySearch = (s: string) => { setSearch(s); setPage(1); };

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
        {peutEcrire && (
          <form style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}
            onSubmit={(e) => { e.preventDefault(); setErr(null); if (libForm.code && libForm.name) createLib.mutate(); }}>
            <Field label="Code"><input value={libForm.code} onChange={(e) => setLibForm({ ...libForm, code: e.target.value })} /></Field>
            <Field label="Nom"><input value={libForm.name} onChange={(e) => setLibForm({ ...libForm, name: e.target.value })} /></Field>
            <button className="btn" type="submit">+ Bibliothèque</button>
          </form>
        )}
      </div>

      {libId && section !== 'ouvrages' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Ressources ({resTotal})</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="input" placeholder="Rechercher code / libellé…" style={{ width: 220 }}
                value={search} onChange={(e) => applySearch(e.target.value)} />
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button className={natFilter === '' ? 'btn' : 'btn-ghost'} style={{ padding: '3px 8px' }} onClick={() => applyFilter('')}>Tous</button>
                {NATURES.map((n) => (
                  <button key={n.v} className={natFilter === n.v ? 'btn' : 'btn-ghost'} style={{ padding: '3px 8px' }} onClick={() => applyFilter(n.v)}>{n.l}</button>
                ))}
              </div>
              {peutEcrire && (
                <button className="btn" onClick={() => setResModal('new')}>+ Nouvelle ressource</button>
              )}
            </div>
          </div>
          {resRows.length > 0 ? (
            <>
              <p className="muted" style={{ fontSize: 10.5, margin: '8px 0 0' }}>
                Cliquez sur un en-tête pour trier · glissez un en-tête (⠿) pour déplacer la colonne.
              </p>
              <table className="grid" style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    {orderedCols.map((col) => (
                      <SortHeader key={col.key} label={col.label} colKey={col.sort} sort={sort} onSort={doSort} right={col.right}
                        draggable onDragStart={() => onColDragStart(col.key)} onDragOver={(e) => e.preventDefault()} onDrop={() => onColDrop(col.key)} dragging={dragKey === col.key} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resRows.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setResModal(r)} title="Modifier la ressource">
                      {orderedCols.map((col) => (
                        <td key={col.key} className={col.cls} style={{ textAlign: col.right ? 'right' : 'left' }}>
                          {col.render(r, nbDec)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, resTotal)} sur {resTotal}
                  </span>
                  <button className="btn-secondary btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Précédent</button>
                  <span className="muted" style={{ fontSize: 11 }}>Page {page} / {totalPages}</span>
                  <button className="btn-secondary btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Suivant ›</button>
                </div>
              )}
            </>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>
              {search || natFilter ? 'Aucune ressource ne correspond au filtre.' : 'Aucune ressource. Cliquez sur « + Nouvelle ressource ».'}
            </p>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Ouvrages composés {ouvrages.data ? `(${ouvrages.data.total})` : ''}</h2>
            {peutEcrire && (
              <Link className="btn" href={`/estimating/bibliotheque/ouvrages/new?lib=${libId}`}>+ Nouvel ouvrage</Link>
            )}
          </div>
          <p className="muted" style={{ marginTop: 4 }}>Cliquez sur un ouvrage pour le composer (ajout de ressources, ratios, pertes…).</p>
          {ouvrages.data && ouvrages.data.rows.length > 0 ? (
            <table className="grid" style={{ marginTop: 8 }}>
              <thead><tr>
                <SortHeader label="Code" colKey="code" sort={ouvSort} onSort={(k) => setOuvSort((s) => nextSort(s, k))} />
                <SortHeader label="Libellé" colKey="label" sort={ouvSort} onSort={(k) => setOuvSort((s) => nextSort(s, k))} />
                <SortHeader label="Catégorie" colKey="categorie" sort={ouvSort} onSort={(k) => setOuvSort((s) => nextSort(s, k))} />
                <SortHeader label="Unité" colKey="unit" sort={ouvSort} onSort={(k) => setOuvSort((s) => nextSort(s, k))} />
                <SortHeader label="Déboursé" colKey="debourse" sort={ouvSort} onSort={(k) => setOuvSort((s) => nextSort(s, k))} right />
                <th style={{ width: 80 }} />
              </tr></thead>
              <tbody>
                {applySort(ouvrages.data.rows, ouvSort, (o, k) => k === 'debourse' ? Number((o as unknown as Record<string, unknown>)[k]) : (o as unknown as Record<string, unknown>)[k]).map((o) => (
                  <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/estimating/bibliotheque/ouvrages/${o.id}`)}>
                    <td className="code-cell">{o.code}</td>
                    <td>{o.label}</td>
                    <td className="muted">{o.categorie || '—'}</td>
                    <td className="muted">{o.unit}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtEuro(o.debourse, nbDec)}</td>
                    <td><span className="link">Composer →</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>Aucun ouvrage. Cliquez sur « + Nouvel ouvrage ».</p>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field" style={{ marginBottom: 0 }}><label>{label}</label>{children}</div>;
}
