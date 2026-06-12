'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { fmtEuro } from '@/lib/preferences';
import type { DragItem } from './Montage';

interface Library { id: string; code: string; name: string }
interface Ouvrage { id: string; code: string; label: string; unit: string; debourse: string }
interface Resource { id: string; code: string; label: string; unit: string; unitCost: string; nature: string; codeAnalytiqueCode?: string | null }
interface Page<T> { rows: T[]; total: number }

const DRAG_KEY = 'application/json';

function setDrag(e: React.DragEvent, item: DragItem) {
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(DRAG_KEY, JSON.stringify(item));
}

export function LibraryDrawer({
  token, onClose, containerId,
}: { token: string | null; onClose: () => void; containerId?: string }) {
  const [libId, setLibId] = useState('');
  const [tab, setTab] = useState<'ouvrages' | 'ressources'>('ouvrages');
  const [search, setSearch] = useState('');
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (containerId) {
      setPortalTarget(document.getElementById(containerId));
    }
  }, [containerId]);


  const libs = useQuery({
    queryKey: ['libraries'], enabled: Boolean(token),
    queryFn: () => apiFetch<Page<Library>>('/libraries?pageSize=100', { token }),
  });
  const ouvrages = useQuery({
    queryKey: ['ouvrages', libId, search], enabled: Boolean(token && libId && tab === 'ouvrages'),
    queryFn: () => apiFetch<Page<Ouvrage>>(`/libraries/${libId}/ouvrages?pageSize=200${search ? `&q=${encodeURIComponent(search)}` : ''}`, { token }),
  });
  const ressources = useQuery({
    queryKey: ['resources', libId, search], enabled: Boolean(token && libId && tab === 'ressources'),
    queryFn: () => apiFetch<Page<Resource>>(`/libraries/${libId}/resources?pageSize=200${search ? `&q=${encodeURIComponent(search)}` : ''}`, { token }),
  });

  const ouvrageRows = (ouvrages.data?.rows ?? []).filter((o) =>
    !search || o.label.toLowerCase().includes(search.toLowerCase()) || o.code.toLowerCase().includes(search.toLowerCase()),
  );
  const ressourceRows = (ressources.data?.rows ?? []).filter((r) =>
    !search || r.label.toLowerCase().includes(search.toLowerCase()) || r.code.toLowerCase().includes(search.toLowerCase()),
  );

  const posStyle: React.CSSProperties = containerId
    ? { position: 'absolute', top: 0, right: 0, bottom: 0, width: 320, zIndex: 10 }
    : { position: 'fixed', top: 0, right: 0, bottom: 0, width: 320, zIndex: 300 };

  const content = (
    <div className="library-drawer" style={{ ...posStyle, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="library-drawer-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border)', color: '#fff' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Bibliothèque</div>
          <div style={{ fontSize: 11, opacity: 0.75 }}>Glisser-déposer dans le devis</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '4px 6px' }}>✕</button>
      </div>

      {/* Library selector */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <select value={libId} onChange={(e) => setLibId(e.target.value)} style={{ width: '100%' }}>
          <option value="">— choisir une bibliothèque —</option>
          {(libs.data?.rows ?? []).map((l) => (
            <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {(['ouvrages', 'ressources'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '8px 0', fontSize: 12, fontWeight: tab === t ? 700 : 400,
            color: tab === t ? 'var(--primary)' : 'var(--muted)',
            background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
            cursor: 'pointer', textTransform: 'capitalize',
          }}>
            {t}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {!libId && (
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, marginTop: 32 }}>
            Sélectionnez une bibliothèque
          </p>
        )}

        {libId && tab === 'ouvrages' && (
          ouvrages.isLoading ? <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, marginTop: 32 }}>Chargement…</p>
          : ouvrageRows.length === 0 ? <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, marginTop: 32 }}>Aucun ouvrage</p>
          : ouvrageRows.map((o) => (
            <div
              key={o.id}
              draggable
              onDragStart={(e) => setDrag(e, { kind: 'ouvrage', id: o.id, code: o.code, label: o.label, unit: o.unit, debourse: o.debourse })}
              title={`Glisser pour insérer « ${o.label} »`}
              style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                padding: '8px 14px', borderBottom: '1px solid var(--border)',
                cursor: 'grab', userSelect: 'none',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--library-item-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{o.code}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{o.unit}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{o.label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtEuro(o.debourse, 2)} €</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>⠿ Glisser dans le devis</div>
            </div>
          ))
        )}

        {libId && tab === 'ressources' && (
          ressources.isLoading ? <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, marginTop: 32 }}>Chargement…</p>
          : ressourceRows.length === 0 ? <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, marginTop: 32 }}>Aucune ressource</p>
          : ressourceRows.map((r) => (
            <div
              key={r.id}
              draggable
              onDragStart={(e) => setDrag(e, { kind: 'ressource', id: r.id, code: r.code, label: r.label, unit: r.unit, debourse: r.unitCost, codeAnalytique: r.codeAnalytiqueCode ?? null })}
              title={`Glisser pour insérer « ${r.label} »`}
              style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                padding: '8px 14px', borderBottom: '1px solid var(--border)',
                cursor: 'grab', userSelect: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--library-item-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{r.code}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.unit}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{r.label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtEuro(r.unitCost, 2)} €/u</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>⠿ Glisser dans le devis</div>
            </div>
          ))
        )}
      </div>

      {/* Footer hint */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
        Déposer sur un titre ou sous-titre du montage
      </div>
    </div>
  );

  if (containerId) {
    return portalTarget ? createPortal(content, portalTarget) : null;
  }
  return content;
}
