'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { Modale } from './Modale';
import { Alerte, Bouton } from './ui';
import { CodeAnalytique, SelectCodeAnalytique } from './SelectCodeAnalytique';
import { SelectOuvrage } from './SelectOuvrage';
import { estFige, PointageJour } from './CalendrierPointages';

interface Employee { id: string; fullName: string; jobTitle: string | null; hourlyCost: string }


/**
 * Saisie et correction d'un pointage.
 *
 * Le même formulaire crée et corrige : une heure mal saisie se rattrape là où on l'a vue, sans
 * supprimer puis ressaisir. Un pointage figé s'ouvre quand même — en lecture, avec la raison
 * écrite : on doit pouvoir vérifier ce qui a été compté même quand il est trop tard pour le
 * changer.
 */
export function PointageModal({
  chantierId, pointage, date, onClose,
}: {
  chantierId: string;
  /** Pointage à corriger ; absent, la fenêtre en crée un. */
  pointage: PointageJour | null;
  /** Jour pré-rempli à la création. */
  date: string;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const fige = pointage ? estFige(pointage) : false;

  const [employeeId, setEmployeeId] = useState(pointage?.employee_id ?? '');
  const [employee, setEmployee] = useState(pointage && !pointage.employee_id ? pointage.employee_label : '');
  const [jour, setJour] = useState(pointage?.work_date ?? date);
  const [hours, setHours] = useState(pointage ? String(Number(pointage.hours)) : '');
  const [hourlyCost, setHourlyCost] = useState(pointage ? String(Number(pointage.hourly_cost)) : '');
  const [executionLineId, setExecutionLineId] = useState<string>('');
  const [codeAnalytiqueId, setCodeAnalytiqueId] = useState<string | null>(null);

  const salaries = useQuery({
    queryKey: ['employees'], enabled: Boolean(token),
    queryFn: () => apiFetch<Employee[]>('/employees', { token }),
  });
  const codes = useQuery({
    queryKey: ['params-codes'], enabled: Boolean(token), retry: false,
    queryFn: () => apiFetch<CodeAnalytique[]>('/params/codes', { token }),
  });

  const rafraichir = () => {
    for (const key of ['timesheets', 'timesheets-summary', 'creneaux', 'creneaux-mois',
      'occupation', 'chantier-analytical', 'execution-tree', 'paye-releve', 'paye-releves']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
  const echoue = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Opération impossible.');

  const enregistrer = useMutation({
    mutationFn: () => {
      const corps: Record<string, unknown> = {
        date: jour, hours, hourlyCost: hourlyCost || undefined,
        executionLineId: executionLineId || null,
        codeAnalytiqueId,
      };
      if (employeeId) corps.employeeId = employeeId; else corps.employee = employee;
      return pointage
        ? apiFetch(`/chantiers/${chantierId}/timesheets/${pointage.id}`, { method: 'PATCH', token, body: corps })
        : apiFetch(`/chantiers/${chantierId}/timesheets`, { method: 'POST', token, body: corps });
    },
    onSuccess: () => { rafraichir(); onClose(); },
    onError: echoue,
  });

  const supprimer = useMutation({
    mutationFn: () => apiFetch(`/chantiers/${chantierId}/timesheets/${pointage?.id}`, {
      method: 'DELETE', token,
    }),
    onSuccess: () => { rafraichir(); onClose(); },
    onError: echoue,
  });

  const cout = hours && hourlyCost ? Number(hours) * Number(hourlyCost) : null;

  return (
    <Modale
      titre={pointage ? 'Pointage' : 'Nouveau pointage'}
      sousTitre={fige
        ? (pointage?.impute
          ? 'Imputé au résultat du chantier : saisissez une ligne de correction plutôt que de modifier celle-ci.'
          : 'Le relevé mensuel du salarié est signé : rouvrez-le pour corriger ces heures.')
        : undefined}
      largeur="m"
      onClose={onClose}
      actions={fige ? undefined : (
        <Bouton
          chargement={enregistrer.isPending}
          libelleChargement="Enregistrement…"
          disabled={(!employeeId && !employee.trim()) || !jour || !hours}
          onClick={() => { setErr(null); enregistrer.mutate(); }}
        >
          Enregistrer
        </Bouton>
      )}
    >
      {err && <Alerte>{err}</Alerte>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
          <label>Salarié</label>
          <select
            value={employeeId}
            disabled={fige}
            onChange={(e) => {
              const id = e.target.value;
              setEmployeeId(id);
              const emp = (salaries.data ?? []).find((x) => x.id === id);
              // Le coût horaire de la fiche s'affiche d'emblée : on voit ce qui sera compté.
              if (emp) setHourlyCost(String(Number(emp.hourlyCost)));
            }}
          >
            <option value="">— Nom libre (intérim de passage) —</option>
            {(salaries.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}{e.jobTitle ? ` · ${e.jobTitle}` : ''}
              </option>
            ))}
          </select>
        </div>
        {!employeeId && (
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}>
            <label>Nom saisi</label>
            <input
              value={employee}
              disabled={fige}
              onChange={(e) => setEmployee(e.target.value)}
              placeholder="Équipe maçonnerie"
            />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0, width: 150 }}>
          <label>Date</label>
          <input type="date" value={jour} disabled={fige} onChange={(e) => setJour(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0, width: 100 }}>
          <label>Heures</label>
          <input
            type="number" min={0} step="0.25" style={{ textAlign: 'right' }}
            value={hours} disabled={fige} onChange={(e) => setHours(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0, width: 130 }}>
          <label>Coût horaire (€)</label>
          <input
            type="number" min={0} step="0.01" style={{ textAlign: 'right' }}
            value={hourlyCost} disabled={fige} onChange={(e) => setHourlyCost(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0, width: 110 }}>
          <label>Coût</label>
          <div style={{ padding: '6px 0', fontWeight: 600, textAlign: 'right' }}>
            {cout !== null ? euro(cout) : '—'}
          </div>
        </div>
      </div>

      <div className="form-section-title" style={{ marginTop: 14 }}>Imputation</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
          <label>Ouvrage (facultatif)</label>
          <SelectOuvrage
            chantierId={chantierId}
            valeur={executionLineId}
            onChange={setExecutionLineId}
            disabled={fige}
          />
        </div>
        <div className="field" style={{ marginBottom: 0, width: 170 }}>
          <label>Code analytique</label>
          <SelectCodeAnalytique
            valeur={codeAnalytiqueId}
            codes={codes.data ?? []}
            onChange={setCodeAnalytiqueId}
            lecture={fige}
          />
          <span className="muted" style={{ fontSize: 11 }}>
            Vide, le poste de la fiche du salarié s’applique.
          </span>
        </div>
      </div>

      {pointage && !fige && (
        <div style={{ marginTop: 14 }}>
          <Bouton
            variante="danger"
            icone={Trash2}
            chargement={supprimer.isPending}
            onClick={() => { setErr(null); supprimer.mutate(); }}
          >
            Supprimer ce pointage
          </Bouton>
        </div>
      )}
    </Modale>
  );
}
