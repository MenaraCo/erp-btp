'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';

function fmtM(val: string | null | undefined): string {
  if (!val) return '—';
  const n = Number(val);
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + ' €';
}
import {
  ChevronRight, ChevronDown, Send, CheckCircle, XCircle, RotateCcw,
  Copy, Trash2, GitBranch, History,
} from 'lucide-react';

interface VersionSummary {
  id: string;
  version_no: number;
  label: string | null;
  created_at: string;
}

interface DevisTotals {
  debourse: string;
  revient: string;
  pvHt: string;
  margeNette: string;
  margeNettePct: string;
}

interface DevisRow {
  id: string;
  numero: string | null;
  designation: string;
  type: string;
  status: string;
  affaire_id: string;
  affaire_code: string;
  affaire_name: string;
  created_at: string | null;
  versions: VersionSummary[];
  totals: DevisTotals | null;
}

interface ChangelogEntry { id: string; designation: string; type: string; changes?: string[] }
interface Changelog {
  previousVersionNo: number | null;
  added: ChangelogEntry[];
  removed: ChangelogEntry[];
  modified: ChangelogEntry[];
}

const TYPE_LABELS: Record<string, string> = { principal: 'Principal', lot: 'Lot', avenant: 'Avenant' };
const STATUS_LABELS: Record<string, string> = {
  open: 'En cours', sent: 'Envoyé', won: 'Gagné', lost: 'Perdu',
  followup: 'Relancé', revision: 'Révision',
};
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  won:              { bg: '#dcfce7', color: '#15803d' },
  lost:             { bg: '#fee2e2', color: '#dc2626' },
  sent:             { bg: '#dbeafe', color: '#1d4ed8' },
  open:             { bg: '#f1f5f9', color: '#475569' },
  revision:         { bg: '#fef9c3', color: '#b45309' },
  followup:         { bg: '#f1f5f9', color: '#475569' },
};

type FilterTab = 'all' | 'open' | 'sent' | 'won' | 'lost';
const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'open', label: 'Ouverts' },
  { key: 'sent', label: 'Envoyés' },
  { key: 'won', label: 'Gagnés' },
  { key: 'lost', label: 'Perdus' },
];
const OPEN_STATUSES = ['open', 'revision', 'followup'];
const FILTER_STATUSES: Record<FilterTab, string[]> = {
  all: [], open: OPEN_STATUSES, sent: ['sent'], won: ['won'], lost: ['lost'],
};

/* ── Bouton icône fantôme ── */
function IconBtn({
  title, onClick, color = 'var(--muted)', children, disabled,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  color?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        background: 'none', border: 'none', borderRadius: 4,
        padding: 4, cursor: disabled ? 'not-allowed' : 'pointer',
        color, opacity: disabled ? 0.4 : 0.85,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'opacity 0.12s, background 0.12s',
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
      onMouseLeave={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
    >
      {children}
    </button>
  );
}

function SortTh({ label, col, sk, dir, onSort, thStyle }: {
  label: string; col: string; sk: string; dir: 'asc' | 'desc';
  onSort: (k: any) => void; thStyle: React.CSSProperties;
}) {
  const active = sk === col;
  return (
    <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(col)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {label}
        <span style={{ fontSize: 9, opacity: active ? 1 : 0.35 }}>{active && dir === 'asc' ? '▲' : '▼'}</span>
      </span>
    </th>
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch {
    return iso.slice(0, 10);
  }
}

/* ── Badge statut ── */
function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { bg: '#f1f5f9', color: '#64748b' };
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
      background: s.bg, color: s.color,
    }}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function DevisListPage() {
  const { token } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<DevisRow | null>(null);
  type SortKey = 'numero' | 'designation' | 'date' | 'debourse' | 'revient' | 'pvHt' | 'margeNette';
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'date' ? 'desc' : 'asc'); }
  }

  /* ── Nouveau devis ── */
  const [showNewDevis, setShowNewDevis] = useState(false);
  const [newAffaireId, setNewAffaireId] = useState('');
  const [newDesignation, setNewDesignation] = useState('');
  const [newType, setNewType] = useState('principal');
  const [newError, setNewError] = useState<string | null>(null);
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<{
    devisId: string; version: VersionSummary; isLatest: boolean; prevVersionNo?: number;
  } | null>(null);
  const [changelog, setChangelog] = useState<{ version: VersionSummary; data: Changelog } | null>(null);

  const list = useQuery({
    queryKey: ['devis-list'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<DevisRow[]>('/devis', { token }),
  });

  const affaires = useQuery({
    queryKey: ['affaires-for-devis'],
    enabled: showNewDevis && Boolean(token),
    queryFn: () => apiFetch<{ rows: { id: string; code: string; name: string }[] }>('/affaires?sort=code&pageSize=200', { token }),
  });

  const createDevis = useMutation({
    mutationFn: () => apiFetch<{ devis: { id: string } }>(
      `/affaires/${newAffaireId}/devis`,
      { token, method: 'POST', body: { designation: newDesignation, type: newType } },
    ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['devis-list'] });
      setShowNewDevis(false);
      setNewAffaireId(''); setNewDesignation(''); setNewType('principal'); setNewError(null);
      router.push(`/estimating/${newAffaireId}/devis/${data.devis.id}`);
    },
    onError: (e) => setNewError(e instanceof ApiError ? e.message : 'Échec de la création'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/devis/${id}`, { token, method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['devis-list'] }); setConfirmDelete(null); },
  });

  const deleteVersionMut = useMutation({
    mutationFn: (versionId: string) => apiFetch(`/versions/${versionId}`, { token, method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['devis-list'] }); setConfirmDeleteVersion(null); },
  });

  const duplicateMut = useMutation({
    mutationFn: (id: string) => apiFetch<{ id: string; affaireId: string }>(`/devis/${id}/duplicate`, { token, method: 'POST' }),
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ['devis-list'] }); router.push(`/estimating/${data.affaireId}/devis/${data.id}`); },
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/devis/${id}/status`, { token, method: 'PUT', body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis-list'] }),
  });

  const toggleExpand = (id: string) =>
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const openChangelog = async (version: VersionSummary) => {
    const data = await apiFetch<Changelog>(`/versions/${version.id}/changelog`, { token });
    setChangelog({ version, data });
  };

  const rows = (list.data ?? [])
    .filter((d) => {
      const matchFilter = FILTER_STATUSES[filter].length === 0 || FILTER_STATUSES[filter].includes(d.status);
      const q = search.toLowerCase();
      const matchSearch = !q ||
        d.designation.toLowerCase().includes(q) ||
        (d.numero ?? '').toLowerCase().includes(q) ||
        d.affaire_code.toLowerCase().includes(q) ||
        d.affaire_name.toLowerCase().includes(q);
      return matchFilter && matchSearch;
    })
    .sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      if (sortKey === 'numero') { va = a.numero ?? ''; vb = b.numero ?? ''; }
      else if (sortKey === 'designation') { va = a.designation; vb = b.designation; }
      else if (sortKey === 'date') { va = a.created_at ?? ''; vb = b.created_at ?? ''; }
      else if (sortKey === 'debourse') { va = Number(a.totals?.debourse ?? 0); vb = Number(b.totals?.debourse ?? 0); }
      else if (sortKey === 'revient') { va = Number(a.totals?.revient ?? 0); vb = Number(b.totals?.revient ?? 0); }
      else if (sortKey === 'pvHt') { va = Number(a.totals?.pvHt ?? 0); vb = Number(b.totals?.pvHt ?? 0); }
      else if (sortKey === 'margeNette') { va = Number(a.totals?.margeNette ?? 0); vb = Number(b.totals?.margeNette ?? 0); }
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string, 'fr') : (va as number) - (vb as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });

  function quickActions(d: DevisRow) {
    if (OPEN_STATUSES.includes(d.status)) {
      return (
        <IconBtn title="Envoyer le devis" color="#3b82f6"
          onClick={(e) => { e.stopPropagation(); statusMut.mutate({ id: d.id, status: 'sent' }); }}
          disabled={statusMut.isPending}>
          <Send size={13} />
        </IconBtn>
      );
    }
    if (d.status === 'sent') {
      return (
        <>
          <IconBtn title="Marquer Gagné" color="#16a34a"
            onClick={(e) => { e.stopPropagation(); statusMut.mutate({ id: d.id, status: 'won' }); }}
            disabled={statusMut.isPending}>
            <CheckCircle size={13} />
          </IconBtn>
          <IconBtn title="Marquer Perdu" color="#dc2626"
            onClick={(e) => { e.stopPropagation(); statusMut.mutate({ id: d.id, status: 'lost' }); }}
            disabled={statusMut.isPending}>
            <XCircle size={13} />
          </IconBtn>
        </>
      );
    }
    if (d.status === 'won' || d.status === 'lost') {
      return (
        <IconBtn title="Rouvrir le devis" color="#64748b"
          onClick={(e) => { e.stopPropagation(); statusMut.mutate({ id: d.id, status: 'open' }); }}
          disabled={statusMut.isPending}>
          <RotateCcw size={13} />
        </IconBtn>
      );
    }
    return null;
  }

  const latestVersion = (d: DevisRow) => d.versions[d.versions.length - 1];

  /* ── Styles compact table ── */
  const thStyle: React.CSSProperties = {
    fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '0.8px',
    color: 'var(--primary)', background: '#f1f5f9', padding: '6px 8px',
    fontWeight: 700, borderBottom: '2px solid var(--border)',
    whiteSpace: 'nowrap', overflow: 'hidden',
  };
  const tdStyle: React.CSSProperties = {
    fontSize: 11, padding: '7px 8px', verticalAlign: 'middle',
    whiteSpace: 'nowrap', overflow: 'hidden',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Devis</h1>
          <p className="muted" style={{ marginTop: 2, marginBottom: 0 }}>Tous les devis, toutes affaires confondues.</p>
        </div>
        <button className="btn" onClick={() => { setShowNewDevis(true); setNewError(null); }}>
          + Nouveau devis
        </button>
      </div>

      {/* Barre de recherche */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, marginBottom: 4 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un devis, affaire…" style={{ flex: 1, maxWidth: 360 }} />
      </div>

      {/* Onglets filtre (avec compteur par statut) */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
        {FILTER_TABS.map((t) => {
          const count = !list.data ? null
            : FILTER_STATUSES[t.key].length === 0
              ? list.data.length
              : list.data.filter((d) => FILTER_STATUSES[t.key].includes(d.status)).length;
          const isActive = filter === t.key;
          return (
            <button key={t.key} onClick={() => setFilter(t.key)} style={{
              padding: '7px 16px', fontSize: 12, background: 'none', border: 'none',
              borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
              color: isActive ? 'var(--primary)' : 'var(--muted)',
              fontWeight: isActive ? 700 : 400, cursor: 'pointer',
            }}>
              {t.label}
              {count != null && (
                <span style={{
                  marginLeft: 5, fontSize: 10, borderRadius: 10, padding: '1px 6px',
                  background: isActive ? 'var(--primary)' : 'var(--border)',
                  color: isActive ? '#fff' : 'var(--muted)', fontWeight: 700,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tableau */}
      <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none', padding: 0, overflowX: 'auto' }}>
        {!list.data && !list.isError && <p className="muted" style={{ padding: '16px' }}>Chargement…</p>}
        {list.isError && <p className="muted" style={{ padding: '16px' }}>Accès non autorisé.</p>}
        {list.data && rows.length === 0 && (
          <p className="muted" style={{ padding: '16px' }}>
            {search || filter !== 'all' ? 'Aucun devis ne correspond.' : 'Aucun devis.'}
          </p>
        )}

        {rows.length > 0 && (
          <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', margin: 0, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 20 }} />
              <col style={{ width: 120 }} />
              <col />
              <col style={{ width: 70 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 68 }} />
              <col style={{ width: 84 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ ...thStyle, padding: '6px 4px' }} />
                <SortTh label="N°" col="numero" sk={sortKey} dir={sortDir} onSort={toggleSort} thStyle={thStyle} />
                <SortTh label="Désignation" col="designation" sk={sortKey} dir={sortDir} onSort={toggleSort} thStyle={thStyle} />
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Statut</th>
                <SortTh label="Déboursé" col="debourse" sk={sortKey} dir={sortDir} onSort={toggleSort} thStyle={{ ...thStyle, textAlign: 'right' }} />
                <SortTh label="Revient" col="revient" sk={sortKey} dir={sortDir} onSort={toggleSort} thStyle={{ ...thStyle, textAlign: 'right' }} />
                <SortTh label="PV HT" col="pvHt" sk={sortKey} dir={sortDir} onSort={toggleSort} thStyle={{ ...thStyle, textAlign: 'right' }} />
                <SortTh label="Marge nette" col="margeNette" sk={sortKey} dir={sortDir} onSort={toggleSort} thStyle={{ ...thStyle, textAlign: 'right' }} />
                <SortTh label="Date" col="date" sk={sortKey} dir={sortDir} onSort={toggleSort} thStyle={thStyle} />
                <th style={{ ...thStyle, textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const isOpen = expanded.has(d.id);
                const latest = latestVersion(d);
                return (
                  <React.Fragment key={d.id}>
                    {/* ── Ligne principale ── */}
                    <tr
                      onClick={() => router.push(`/estimating/${d.affaire_id}/devis/${d.id}`)}
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    >
                      {/* Chevron expand */}
                      <td style={{ ...tdStyle, padding: '0 2px', textAlign: 'center' }}
                        onClick={(e) => { e.stopPropagation(); if (d.versions.length > 1) toggleExpand(d.id); }}>
                        {d.versions.length > 1 && (
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center' }}>
                            {isOpen
                              ? <ChevronDown size={13} />
                              : <ChevronRight size={13} />}
                          </button>
                        )}
                      </td>

                      {/* N° + badge version */}
                      <td style={{ ...tdStyle, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                            {d.numero ?? '—'}
                          </span>
                          {latest && latest.version_no > 1 && (
                            <span style={{
                              fontSize: 9, padding: '1px 5px', borderRadius: 8, flexShrink: 0,
                              background: 'var(--primary)', color: '#fff', fontWeight: 700,
                              textTransform: 'uppercase', letterSpacing: '0.05em',
                            }}>
                              v{latest.version_no}
                            </span>
                          )}
                        </div>
                      </td>

                      <td style={{ ...tdStyle, overflow: 'hidden', maxWidth: 0 }}>
                        <div style={{ fontWeight: 500, color: 'var(--ink-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.designation}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--accent)', marginRight: 3 }}>{d.affaire_code}</span>
                          {d.affaire_name}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--muted)' }}>{TYPE_LABELS[d.type] ?? d.type}</td>
                      <td style={tdStyle}><StatusBadge status={d.status} /></td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>
                        {fmtM(d.totals?.debourse)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>
                        {fmtM(d.totals?.revient)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--ink-strong)' }}>
                        {fmtM(d.totals?.pvHt)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {d.totals ? (
                          <span>
                            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: Number(d.totals.margeNette) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                              {fmtM(d.totals.margeNette)}
                            </span>
                            <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--muted)' }}>
                              {d.totals.margeNettePct}%
                            </span>
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDate(latest?.created_at ?? d.created_at)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', gap: 0, alignItems: 'center' }}>
                          {quickActions(d)}
                          <IconBtn title="Dupliquer" color="#64748b"
                            onClick={(e) => { e.stopPropagation(); duplicateMut.mutate(d.id); }}
                            disabled={duplicateMut.isPending}>
                            <Copy size={13} />
                          </IconBtn>
                          <IconBtn title="Supprimer le devis" color="#dc2626"
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(d); }}>
                            <Trash2 size={12} />
                          </IconBtn>
                        </span>
                      </td>
                    </tr>

                    {/* ── Sous-lignes versions ── */}
                    {isOpen && d.versions.slice().reverse().map((v) => {
                      const isLatestV = v.id === latest?.id;
                      const vIdx = d.versions.findIndex((x) => x.id === v.id);
                      const prevVersion = vIdx > 0 ? d.versions[vIdx - 1] : undefined;
                      return (
                        <tr key={v.id}
                          onClick={() => router.push(`/estimating/${d.affaire_id}/devis/${d.id}?v=${v.id}`)}
                          style={{
                            cursor: 'pointer',
                            borderLeft: '3px solid #93c5fd',
                            borderBottom: '1px solid var(--border)',
                            background: '#f8fafc',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = '#eff6ff'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                        >
                          <td style={{ ...tdStyle, padding: '0 4px' }} />
                          <td style={{ ...tdStyle, paddingLeft: 20 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <GitBranch size={10} color="#93c5fd" />
                              <span style={{
                                fontSize: 9, padding: '1px 5px', borderRadius: 8, fontWeight: 700,
                                background: isLatestV ? 'var(--primary)' : 'var(--border)',
                                color: isLatestV ? '#fff' : 'var(--muted)',
                                textTransform: 'uppercase', letterSpacing: '0.05em',
                              }}>
                                v{v.version_no}
                              </span>
                            </span>
                          </td>
                          <td style={{ ...tdStyle, color: 'var(--muted)', fontStyle: 'italic' }}>
                            {isLatestV
                              ? <span style={{ color: 'var(--primary)', fontStyle: 'normal', fontWeight: 600 }}>Version actuelle</span>
                              : 'Révision archivée'}
                            {v.label && v.label !== `v${v.version_no}` && (
                              <span style={{ marginLeft: 8, fontSize: 10 }}>— {v.label}</span>
                            )}
                          </td>
                          <td colSpan={6} />
                          <td style={{ ...tdStyle, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(v.created_at)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            <span style={{ display: 'inline-flex', gap: 0, alignItems: 'center' }}>
                              {v.version_no > 1 && (
                                <IconBtn title="Voir le changelog de cette version" color="#64748b"
                                  onClick={(e) => { e.stopPropagation(); openChangelog(v); }}>
                                  <History size={12} />
                                </IconBtn>
                              )}
                              <IconBtn title="Supprimer cette version" color="#dc2626"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteVersion({
                                    devisId: d.id,
                                    version: v,
                                    isLatest: isLatestV,
                                    prevVersionNo: prevVersion?.version_no,
                                  });
                                }}>
                                <Trash2 size={12} />
                              </IconBtn>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modal suppression devis ── */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setConfirmDelete(null)}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: 400, boxShadow: '0 8px 40px rgba(15,23,42,0.18)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 10px', fontSize: 15, color: 'var(--ink-strong)' }}>Supprimer le devis ?</h3>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 20 }}>
              <strong>{confirmDelete.designation}</strong> et toutes ses versions seront définitivement supprimés.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirmDelete(null)}>Annuler</button>
              <button className="btn" onClick={() => deleteMut.mutate(confirmDelete.id)} disabled={deleteMut.isPending}
                style={{ background: 'var(--danger)', color: '#fff', border: 'none' }}>
                {deleteMut.isPending ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal suppression version ── */}
      {confirmDeleteVersion && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setConfirmDeleteVersion(null)}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: 420, boxShadow: '0 8px 40px rgba(15,23,42,0.18)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 10px', fontSize: 15, color: 'var(--ink-strong)' }}>Supprimer la version ?</h3>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>
              La <strong>v{confirmDeleteVersion.version.version_no}</strong> sera définitivement supprimée.
            </p>
            {confirmDeleteVersion.isLatest && confirmDeleteVersion.prevVersionNo != null && (
              <p style={{ color: '#d97706', fontSize: 12, marginBottom: 16, padding: '8px 10px', background: '#fffbeb', borderRadius: 6, borderLeft: '3px solid #d97706' }}>
                C&apos;est la version actuelle. La <strong>v{confirmDeleteVersion.prevVersionNo}</strong> deviendra la nouvelle version actuelle.
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setConfirmDeleteVersion(null)}>Annuler</button>
              <button className="btn" onClick={() => deleteVersionMut.mutate(confirmDeleteVersion.version.id)}
                disabled={deleteVersionMut.isPending}
                style={{ background: 'var(--danger)', color: '#fff', border: 'none' }}>
                {deleteVersionMut.isPending ? 'Suppression…' : 'Supprimer la version'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal historique (changelog) ── */}
      {changelog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setChangelog(null)}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: 560, maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(15,23,42,0.18)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: 'var(--ink-strong)' }}>
                Historique — v{changelog.data.previousVersionNo} → v{changelog.version.version_no}
              </h3>
              <button onClick={() => setChangelog(null)}
                style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--muted)', padding: 4, lineHeight: 1 }}>✕</button>
            </div>

            {changelog.data.added.length === 0 && changelog.data.removed.length === 0 && changelog.data.modified.length === 0 && (
              <p className="muted" style={{ fontSize: 12 }}>Aucune modification détectée entre ces deux versions.</p>
            )}

            {changelog.data.added.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  + Ajoutés ({changelog.data.added.length})
                </div>
                {changelog.data.added.map((l) => (
                  <div key={l.id} style={{ fontSize: 12, padding: '4px 10px', background: '#f0fdf4', borderLeft: '3px solid #16a34a', marginBottom: 3, borderRadius: 3 }}>
                    {l.designation}
                  </div>
                ))}
              </div>
            )}

            {changelog.data.removed.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  − Supprimés ({changelog.data.removed.length})
                </div>
                {changelog.data.removed.map((l) => (
                  <div key={l.id} style={{ fontSize: 12, padding: '4px 10px', background: '#fef2f2', borderLeft: '3px solid var(--danger)', marginBottom: 3, borderRadius: 3, textDecoration: 'line-through', color: 'var(--muted)' }}>
                    {l.designation}
                  </div>
                ))}
              </div>
            )}

            {changelog.data.modified.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#d97706', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  ✎ Modifiés ({changelog.data.modified.length})
                </div>
                {changelog.data.modified.map((l) => (
                  <div key={l.id} style={{ fontSize: 12, padding: '6px 10px', background: '#fffbeb', borderLeft: '3px solid #d97706', marginBottom: 4, borderRadius: 3 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{l.designation}</div>
                    {(l.changes as string[]).map((c, i) => (
                      <div key={i} style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{c}</div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal nouveau devis ── */}
      {showNewDevis && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowNewDevis(false)}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: 440, boxShadow: '0 8px 40px rgba(15,23,42,0.18)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 18px', fontSize: 15, color: 'var(--ink-strong)' }}>Nouveau devis</h3>
            {newError && <div className="error">{newError}</div>}
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!newAffaireId) { setNewError('Sélectionnez une affaire.'); return; }
              if (!newDesignation.trim()) { setNewError('La désignation est obligatoire.'); return; }
              createDevis.mutate();
            }}>
              <div className="field">
                <label>Affaire *</label>
                <select value={newAffaireId} onChange={(e) => setNewAffaireId(e.target.value)}>
                  <option value="">— Choisir une affaire —</option>
                  {(affaires.data?.rows ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Désignation *</label>
                <input value={newDesignation} onChange={(e) => setNewDesignation(e.target.value)}
                  placeholder="Ex. Lot Peinture – Bâtiment A" autoFocus />
              </div>
              <div className="field">
                <label>Type</label>
                <select value={newType} onChange={(e) => setNewType(e.target.value)}>
                  <option value="principal">Principal</option>
                  <option value="lot">Lot</option>
                  <option value="avenant">Avenant</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="link" onClick={() => setShowNewDevis(false)}>Annuler</button>
                <button type="submit" className="btn" disabled={createDevis.isPending}>
                  {createDevis.isPending ? 'Création…' : 'Créer le devis'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
