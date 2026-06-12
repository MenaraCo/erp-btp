'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { DevisEditorContent } from '@/app/(app)/estimating/[affaireId]/devis/[devisId]/DevisEditorContent';

interface DevisListItem {
  id: string;
  numero: string | null;
  designation: string;
  affaire_id: string;
  affaire_code: string;
  affaire_name: string;
}

export function SplitLayout({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const ws = useWorkspace();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragOrigin = useRef({ x: 0, y: 0, startRatio: 0.5 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Current Panel A devis ID extracted from the URL
  const panelADevisId = (() => {
    const m = pathname?.match(/\/devis\/([^/]+)/);
    return m ? m[1] : null;
  })();

  // All devis for the Panel B dropdown (filtered to exclude Panel A devis)
  const allDevis = useQuery<DevisListItem[]>({
    queryKey: ['all-devis-for-split'],
    enabled: Boolean(token && ws.splitOpen),
    queryFn: () =>
      apiFetch<{ rows: DevisListItem[] }>('/devis?pageSize=500', { token })
        .then((res) => ((res as any).rows ?? res) as DevisListItem[]),
    staleTime: 60_000,
  });

  const handleDividerMouseDown = useCallback((ev: React.MouseEvent) => {
    ev.preventDefault();
    dragging.current = true;
    dragOrigin.current = { x: ev.clientX, y: ev.clientY, startRatio: ws.splitRatio };
  }, [ws.splitRatio]);

  useEffect(() => {
    const isVert = ws.splitDirection === 'vertical';
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const delta = isVert
        ? (ev.clientX - dragOrigin.current.x) / rect.width
        : (ev.clientY - dragOrigin.current.y) / rect.height;
      ws.setSplitRatio(dragOrigin.current.startRatio + delta);
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [ws.splitDirection, ws.setSplitRatio]);

  if (!mounted || !ws.splitOpen) {
    return <main className="main">{children}</main>;
  }

  const isVert = ws.splitDirection === 'vertical';
  const isMinimized = ws.panel2Mode === 'minimized';
  const isMaximized = ws.panel2Mode === 'maximized';
  const ratio = ws.splitRatio;

  const panelAOuterStyle: React.CSSProperties = isMaximized
    ? { flex: '0 0 0', overflow: 'hidden', minWidth: 0, minHeight: 0 }
    : isMinimized
    ? { flex: '1 1 0', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        minWidth: isVert ? 0 : undefined, minHeight: !isVert ? 0 : undefined }
    : { flex: `0 0 ${ratio * 100}%`, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        minWidth: isVert ? 0 : undefined, minHeight: !isVert ? 0 : undefined };

  const panelBWrapStyle: React.CSSProperties = isMinimized
    ? { flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: isVert ? 'column' : 'row',
        ...(isVert ? { width: 40, borderLeft: '1px solid var(--border)' } : { height: 40, borderTop: '1px solid var(--border)' }) }
    : { flex: isMaximized ? '1 1 0' : `0 0 ${(1 - ratio) * 100}%`, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        minWidth: isVert ? 0 : undefined, minHeight: !isVert ? 0 : undefined,
        ...(isVert ? { borderLeft: '1px solid var(--border)' } : { borderTop: '1px solid var(--border)' }) };

  // Group devis by affaire for the dropdown (exclude current Panel A devis)
  const filteredDevis = (allDevis.data ?? []).filter((d) => d.id !== panelADevisId);
  const byAffaire = filteredDevis.reduce<Record<string, { label: string; items: DevisListItem[] }>>((acc, d) => {
    if (!acc[d.affaire_id]) acc[d.affaire_id] = { label: `${d.affaire_code} — ${d.affaire_name}`, items: [] };
    acc[d.affaire_id].items.push(d);
    return acc;
  }, {});

  const dirIcon = ws.splitDirection === 'vertical' ? '⇕' : '⇔';

  return (
    <main
      ref={containerRef as React.RefObject<HTMLElement>}
      className="main main-split"
      style={{ flexDirection: isVert ? 'row' : 'column' }}
    >
      {/* Panel A */}
      {!isMaximized && (
        <div style={panelAOuterStyle}>
          {/* Panel A window bar */}
          <div className="split-window-bar split-window-bar-a">
            <span className="win-label">A</span>
            <span className="win-sep" />
            <div style={{ flex: 1 }} />
            <button type="button"
              className={`win-btn${ws.splitDirection === 'horizontal' ? ' active' : ''}`}
              title={ws.splitDirection === 'vertical' ? 'Passer en horizontal' : 'Passer en vertical'}
              onClick={ws.toggleDirection}
            >{dirIcon}</button>
          </div>
          {/* Content area: position relative so the library portal anchors here */}
          <div id="split-panel-a-anchor" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <div id="split-panel-a-scroll" className="split-scroll" style={{ position: 'absolute', inset: 0, overflow: 'auto', paddingTop: 18, paddingLeft: 22, paddingBottom: 18 }}>
              <div className="split-scroll-content">{children}</div>
            </div>
            {/* Library portal target — library renders here via createPortal */}
            <div id="split-panel-a-library" />
          </div>
        </div>
      )}

      {/* Draggable divider */}
      {!isMaximized && !isMinimized && (
        <div
          className="split-divider"
          style={{ cursor: isVert ? 'col-resize' : 'row-resize' }}
          onMouseDown={handleDividerMouseDown}
        />
      )}

      {/* Panel B */}
      <div className="split-panel-b" style={panelBWrapStyle}>

        {/* Panel B window bar */}
        <div className="split-window-bar">
          {isMinimized ? (
            <div style={{
              display: 'flex', flexDirection: isVert ? 'column' : 'row',
              alignItems: 'center', gap: 4, flex: 1, justifyContent: 'center',
            }}>
              <button type="button" className="win-btn" title="Restaurer" onClick={ws.toggleMinimize}>⊡</button>
              <button type="button" className="win-btn win-btn-close" title="Fermer" onClick={ws.closePanel2}>✕</button>
            </div>
          ) : (
            <>
              <span className="win-label">B</span>
              <span className="win-sep" />

              <select
                className="win-select"
                value={ws.panel2DevisId ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  const found = (allDevis.data ?? []).find((d) => d.id === val);
                  if (found) ws.selectPanel2(val, found.affaire_id);
                }}
              >
                <option value="">— Sélectionner un devis —</option>
                {Object.values(byAffaire).map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.numero ? `${d.numero} — ` : ''}{d.designation}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              <div style={{ flex: 1 }} />

              <button type="button"
                className={`win-btn${ws.splitDirection === 'horizontal' ? ' active' : ''}`}
                title={ws.splitDirection === 'vertical' ? 'Passer en horizontal' : 'Passer en vertical'}
                onClick={ws.toggleDirection}
              >{dirIcon}</button>
              <button type="button" className="win-btn" title="Réduire" onClick={ws.toggleMinimize}>−</button>
              <button type="button"
                className={`win-btn${isMaximized ? ' active' : ''}`}
                title={isMaximized ? 'Restaurer' : 'Maximiser'}
                onClick={ws.toggleMaximize}
              >▢</button>
              <button type="button" className="win-btn win-btn-close" title="Fermer" onClick={ws.closePanel2}>✕</button>
            </>
          )}
        </div>

        {/* Panel B content */}
        {!isMinimized && (
          <div id="split-panel-b-anchor" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <div id="split-panel-b-scroll" className="split-scroll" style={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
              <div className="split-scroll-content">
                {ws.panel2DevisId && ws.panel2AffaireId ? (
                  <DevisEditorContent
                    key={ws.panel2DevisId}
                    affaireId={ws.panel2AffaireId}
                    devisId={ws.panel2DevisId}
                    isPanel2
                  />
                ) : (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', marginTop: 40 }}>
                    {allDevis.isLoading
                      ? <p>Chargement…</p>
                      : <p>Sélectionnez un devis dans la barre ci-dessus.</p>}
                  </div>
                )}
              </div>
            </div>
            {/* Library portal target for Panel B */}
            <div id="split-panel-b-library" />
          </div>
        )}
      </div>
    </main>
  );
}
