'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';

interface Employee {
  id: string;
  code: string;
  firstName: string | null;
  lastName: string;
  fullName: string;
  jobTitle: string | null;
  hourlyCost: string;
  contractType: 'salarie' | 'interimaire' | 'apprenti';
  active: boolean;
}

const CONTRATS: Record<Employee['contractType'], string> = {
  salarie: 'Salarié',
  interimaire: 'Intérimaire',
  apprenti: 'Apprenti',
};

/**
 * Fichier des salariés du suivi de chantiers.
 *
 * Le pointage s'appuyait sur un nom tapé à la main : deux orthographes créaient deux personnes et
 * le coût horaire était ressaisi — donc parfois faux. La fiche porte le COÛT HORAIRE DE REVIENT
 * (ce que l'heure coûte à l'entreprise), repris automatiquement à la saisie des heures.
 */
export default function SalariesPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [tous, setTous] = useState(false);
  const [aSupprimer, setASupprimer] = useState<string | null>(null);

  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [hourlyCost, setHourlyCost] = useState('');
  const [contractType, setContractType] = useState<Employee['contractType']>('salarie');

  const liste = useQuery({
    queryKey: ['employees', tous],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Employee[]>(`/employees${tous ? '?tous=1' : ''}`, { token }),
  });

  const rafraichir = () => qc.invalidateQueries({ queryKey: ['employees'] });

  const creer = useMutation({
    mutationFn: () =>
      apiFetch('/employees', {
        method: 'POST',
        token,
        body: { lastName, firstName, jobTitle, hourlyCost: hourlyCost || '0', contractType },
      }),
    onSuccess: () => {
      setErr(null);
      setLastName(''); setFirstName(''); setJobTitle(''); setHourlyCost('');
      rafraichir();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Création impossible'),
  });

  const modifier = useMutation({
    mutationFn: (v: { id: string; patch: Partial<Employee> }) =>
      apiFetch(`/employees/${v.id}`, { method: 'PATCH', token, body: v.patch }),
    onSuccess: () => { setErr(null); rafraichir(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Modification impossible'),
  });

  const supprimer = useMutation({
    mutationFn: (id: string) => apiFetch<{ deactivated: boolean }>(`/employees/${id}`, { method: 'DELETE', token }),
    onSuccess: (r) => {
      setASupprimer(null);
      setErr(r.deactivated
        ? 'Ce salarié a déjà pointé : ses heures composent le réalisé du chantier. Il a été rendu inactif plutôt que supprimé.'
        : null);
      rafraichir();
    },
    onError: (e) => { setASupprimer(null); setErr(e instanceof ApiError ? e.message : 'Suppression impossible'); },
  });

  const valide = lastName.trim() !== '';

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Salariés</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 720 }}>
        Le fichier des personnes qui pointent sur vos chantiers. Le <strong>coût horaire</strong> est
        celui de revient — ce que l’heure coûte à l’entreprise, charges comprises — et non le salaire
        brut : c’est lui qui alimente le réalisé main-d’œuvre.
      </p>

      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>Ajouter un salarié</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Nom</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Dubois" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Prénom</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Marc" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Qualification</label>
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Maçon, chef d’équipe…" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Coût horaire (€)</label>
            <input type="number" min={0} step="0.01" value={hourlyCost}
              onChange={(e) => setHourlyCost(e.target.value)}
              style={{ width: 110, textAlign: 'right' }} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Contrat</label>
            <select value={contractType} onChange={(e) => setContractType(e.target.value as Employee['contractType'])}>
              {Object.entries(CONTRATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <button className="btn" disabled={!valide || creer.isPending} onClick={() => creer.mutate()}>
            {creer.isPending ? 'Ajout…' : '+ Ajouter'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
          <h2 style={{ margin: 0 }}>
            {liste.data ? `${liste.data.length} salarié${liste.data.length > 1 ? 's' : ''}` : 'Chargement…'}
          </h2>
          <label className="muted" style={{ fontSize: 12, marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={tous} onChange={(e) => setTous(e.target.checked)} />
            Afficher aussi les inactifs
          </label>
        </div>
        {liste.data && liste.data.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ margin: 0, minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Code</th><th>Salarié</th><th>Qualification</th><th>Contrat</th>
                  <th style={{ textAlign: 'right' }}>Coût horaire</th><th>État</th><th />
                </tr>
              </thead>
              <tbody>
                {liste.data.map((e) => (
                  <tr key={e.id} style={{ opacity: e.active ? 1 : 0.55 }}>
                    <td className="code-cell">{e.code}</td>
                    <td>{e.fullName}</td>
                    <td className="muted">{e.jobTitle ?? '—'}</td>
                    <td className="muted">{CONTRATS[e.contractType]}</td>
                    <td style={{ textAlign: 'right' }}>{euro(Number(e.hourlyCost))}</td>
                    <td>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: 11 }}
                        onClick={() => modifier.mutate({ id: e.id, patch: { active: !e.active } })}
                      >
                        {e.active ? 'Actif' : 'Inactif'}
                      </button>
                    </td>
                    <td style={{ textAlign: 'right', width: 150 }}>
                      {/* Confirmation en ligne : la fenêtre système du navigateur est bloquée ici. */}
                      {aSupprimer === e.id ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: 11 }}
                            disabled={supprimer.isPending}
                            onClick={() => supprimer.mutate(e.id)}>
                            Supprimer ?
                          </button>
                          <button className="link" type="button" onClick={() => setASupprimer(null)}>✕</button>
                        </span>
                      ) : (
                        <button className="btn-ghost" title="Retirer ce salarié" onClick={() => { setErr(null); setASupprimer(e.id); }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {liste.data && liste.data.length === 0 && (
          <p className="muted" style={{ padding: 16, margin: 0 }}>
            Aucun salarié pour l’instant. Ajoutez-en un ci-dessus : il sera proposé à la saisie des heures.
          </p>
        )}
      </div>
    </div>
  );
}
