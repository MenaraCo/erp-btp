'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';

interface TimesheetEntry {
  id: string;
  employee_label: string;
  work_date: string;
  hours: string;
  hourly_cost: string;
  cost: string;
}
interface Employee {
  id: string;
  code: string;
  fullName: string;
  jobTitle: string | null;
  hourlyCost: string;
}
interface TimesheetSummary {
  totalCost: string;
  totalHours: string;
}

/** Écran Pointages d'un chantier : saisie des heures de main d'œuvre (réalisé MO, cahier §5.5). */
export default function PointagesPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const chantierId = String(useParams().chantierId);

  // Salarié choisi dans le fichier : son coût horaire est repris, mais reste forçable
  // (heure de nuit, intérim facturé autrement).
  const [employeeId, setEmployeeId] = useState('');
  const [employee, setEmployee] = useState('');
  const [date, setDate] = useState('');
  const [hours, setHours] = useState('');
  const [hourlyCost, setHourlyCost] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const chantier = useQuery({
    queryKey: ['chantier', chantierId],
    enabled: Boolean(token),
    queryFn: () => apiFetch<{ code: string }>(`/chantiers/${chantierId}`, { token }),
  });
  // Fichier des salariés : la saisie s'appuie dessus plutôt que sur un nom retapé chaque fois.
  const salaries = useQuery({
    queryKey: ['employees'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Employee[]>('/employees', { token }),
  });
  const list = useQuery({
    queryKey: ['timesheets', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<TimesheetEntry[]>(`/chantiers/${chantierId}/timesheets`, { token }),
  });
  const summary = useQuery({
    queryKey: ['timesheets-summary', chantierId],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<TimesheetSummary>(`/chantiers/${chantierId}/timesheets/summary`, { token }),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/chantiers/${chantierId}/timesheets`, {
        method: 'POST',
        token,
        body: employeeId
          ? { employeeId, date, hours, hourlyCost: hourlyCost || undefined }
          : { employee, date, hours, hourlyCost },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheets', chantierId] });
      qc.invalidateQueries({ queryKey: ['timesheets-summary', chantierId] });
      setEmployee(''); setDate(''); setHours(''); setHourlyCost('');
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const previewCost =
    hours && hourlyCost ? Number(hours) * Number(hourlyCost) : null;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href={`/chantiers/${chantierId}`} className="link">← Chantier {chantier.data?.code ?? ''}</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>Pointages</h1>
      <p className="muted" style={{ marginTop: 0 }}>Saisie des heures de main d’œuvre imputées au chantier.</p>

      {summary.data && (
        <div className="card-grid" style={{ marginTop: 12 }}>
          <div className="card"><h2>Heures pointées</h2><div className="stat">{summary.data.totalHours} h</div></div>
          <div className="card"><h2>Coût main d’œuvre</h2><div className="stat">{euro(summary.data.totalCost)}</div></div>
        </div>
      )}
      {summary.isError && (
        <p className="muted">Module « Suivi de chantiers » non actif pour cet utilisateur, ou accès refusé.</p>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Nouveau pointage</h2>
        {err && <div className="error">{err}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setErr(null);
            if ((!employeeId && !employee.trim()) || !date || !hours || (!employeeId && !hourlyCost)) {
              setErr('Renseignez le salarié/équipe, la date, les heures et le coût horaire.');
              return;
            }
            create.mutate();
          }}
        >
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Salarié</label>
              <select
                value={employeeId}
                onChange={(e) => {
                  const id = e.target.value;
                  setEmployeeId(id);
                  // Le coût horaire de la fiche s'affiche d'emblée : on voit ce qui sera compté.
                  const emp = (salaries.data ?? []).find((x) => x.id === id);
                  if (emp) setHourlyCost(String(Number(emp.hourlyCost)));
                }}
                style={{ width: 200 }}
              >
                <option value="">— Nom libre (intérim de passage) —</option>
                {(salaries.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}{e.jobTitle ? ` · ${e.jobTitle}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0, display: employeeId ? 'none' : undefined }}>
              <label>Nom saisi</label>
              <input value={employee} onChange={(e) => setEmployee(e.target.value)} placeholder="Équipe maçonnerie" style={{ width: 200 }} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Heures</label>
              <input type="number" min={0} step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} style={{ width: 90, textAlign: 'right' }} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Coût horaire (€)</label>
              <input type="number" min={0} step="0.01" value={hourlyCost} onChange={(e) => setHourlyCost(e.target.value)} style={{ width: 110, textAlign: 'right' }} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Coût</label>
              <div style={{ padding: '6px 0', fontWeight: 600, minWidth: 90, textAlign: 'right' }}>
                {previewCost !== null ? euro(previewCost) : '—'}
              </div>
            </div>
            <button className="btn" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Enregistrement…' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <table className="grid" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Salarié / équipe</th>
              <th>Date</th>
              <th style={{ textAlign: 'right' }}>Heures</th>
              <th style={{ textAlign: 'right' }}>Coût horaire</th>
              <th style={{ textAlign: 'right' }}>Coût</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((e) => (
              <tr key={e.id}>
                <td>{e.employee_label}</td>
                <td>{new Date(e.work_date).toLocaleDateString('fr-FR')}</td>
                <td style={{ textAlign: 'right' }}>{e.hours}</td>
                <td style={{ textAlign: 'right' }}>{euro(e.hourly_cost)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{euro(e.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && list.data.length === 0 && (
          <p className="muted" style={{ padding: 16 }}>Aucun pointage. Ajoutez le premier ci-dessus.</p>
        )}
      </div>
    </div>
  );
}
