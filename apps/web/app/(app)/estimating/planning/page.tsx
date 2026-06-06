'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS } from '@/lib/format';

interface DevisRow {
  id: string;
  numero: string | null;
  designation: string;
  status: string;
  affaire_code: string;
  responsable: string | null;
  priorite: string;
  date_debut: string | null;
  date_echeance: string | null;
}

const PRIORITES = ['basse', 'normale', 'urgente', 'critique'];
const PRIO_COLOR: Record<string, string> = {
  basse: '#94a3b8', normale: '#2563eb', urgente: '#e8550a', critique: '#dc2626',
};
const DONE = new Set(['won', 'lost']);

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export default function PlanningEtudesPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState<'tableau' | 'gantt'>('tableau');

  const list = useQuery({
    queryKey: ['devis-list'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<DevisRow[]>('/devis', { token }),
  });

  const setPlanning = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch(`/devis/${id}/planning`, { method: 'PATCH', body: patch, token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis-list'] }),
  });

  // études en cours (hors gagnés/perdus)
  const etudes = useMemo(
    () => (list.data ?? []).filter((d) => !DONE.has(d.status)),
    [list.data],
  );

  // Fenêtre Gantt : aujourd'hui − 7j → +84j
  const win = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 91);
    const totalDays = daysBetween(start, end);
    const weeks: Date[] = [];
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 7)) weeks.push(new Date(d));
    return { start, end, totalDays, weeks };
  }, []);

  const ganttRows = etudes.filter((d) => d.date_debut && d.date_echeance);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Planning des études</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={view === 'tableau' ? 'btn' : 'btn-secondary'} onClick={() => setView('tableau')}>Tableau</button>
          <button className={view === 'gantt' ? 'btn' : 'btn-secondary'} onClick={() => setView('gantt')}>Gantt</button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Devis en étude — responsable, priorité et échéances.</p>

      {view === 'tableau' && (
        <div className="card" style={{ marginTop: 12 }}>
          {etudes.length > 0 ? (
            <table className="grid">
              <thead><tr>
                <th>Devis</th><th>Affaire</th><th>Statut</th><th>Responsable</th><th>Priorité</th><th>Début</th><th>Échéance</th>
              </tr></thead>
              <tbody>
                {etudes.map((d) => (
                  <tr key={d.id}>
                    <td>{d.numero ? <span className="code-cell">{d.numero} </span> : null}{d.designation}</td>
                    <td className="muted">{d.affaire_code}</td>
                    <td><span className="badge">{AFFAIRE_STATUS_LABELS[d.status] ?? d.status}</span></td>
                    <td>
                      <input style={{ width: 130 }} defaultValue={d.responsable ?? ''}
                        onBlur={(e) => e.target.value !== (d.responsable ?? '') && setPlanning.mutate({ id: d.id, patch: { responsable: e.target.value || null } })} />
                    </td>
                    <td>
                      <select value={d.priorite} onChange={(e) => setPlanning.mutate({ id: d.id, patch: { priorite: e.target.value } })}
                        style={{ borderLeft: `3px solid ${PRIO_COLOR[d.priorite] ?? '#94a3b8'}` }}>
                        {PRIORITES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>
                      <input type="date" defaultValue={d.date_debut ?? ''}
                        onChange={(e) => setPlanning.mutate({ id: d.id, patch: { dateDebut: e.target.value || null } })} />
                    </td>
                    <td>
                      <input type="date" defaultValue={d.date_echeance ?? ''}
                        onChange={(e) => setPlanning.mutate({ id: d.id, patch: { dateEcheance: e.target.value || null } })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">Aucun devis en étude.</p>}
        </div>
      )}

      {view === 'gantt' && (
        <div className="card" style={{ marginTop: 12, overflowX: 'auto' }}>
          {ganttRows.length > 0 ? (
            <div style={{ minWidth: 760 }}>
              {/* en-tête semaines */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                <div style={{ width: 220, flexShrink: 0 }} className="label">Devis</div>
                <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
                  {win.weeks.map((w, i) => (
                    <div key={i} style={{ flex: 1, fontSize: 9, color: 'var(--muted)', borderLeft: '1px solid var(--border)', paddingLeft: 3 }}>
                      {w.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                    </div>
                  ))}
                </div>
              </div>
              {/* lignes */}
              {ganttRows.map((d) => {
                const s = new Date(d.date_debut!); const e = new Date(d.date_echeance!);
                const left = Math.max(0, daysBetween(win.start, s) / win.totalDays) * 100;
                const width = Math.max(1.5, (daysBetween(s, e) || 1) / win.totalDays * 100);
                return (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--surface)' }}>
                    <div style={{ width: 220, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                      {d.numero ? <span className="code-cell">{d.numero} </span> : null}{d.designation}
                    </div>
                    <div style={{ flex: 1, position: 'relative', height: 18 }}>
                      <div title={`${d.responsable ?? ''} · ${d.priorite}`}
                        style={{ position: 'absolute', left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, height: 14, top: 2, background: PRIO_COLOR[d.priorite] ?? '#94a3b8', borderRadius: 3, opacity: 0.85 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="muted">Renseignez des dates (début + échéance) dans l’onglet Tableau pour afficher le Gantt.</p>}
        </div>
      )}
    </div>
  );
}
