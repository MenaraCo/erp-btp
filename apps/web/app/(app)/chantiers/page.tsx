'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';

interface Chantier {
  id: string;
  code: string;
  name?: string | null;
  budget_vente_ht: string | null;
}

export default function ChantiersPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['chantiers'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Chantier[]>('/chantiers', { token }),
  });

  const create = useMutation({
    mutationFn: () => apiFetch('/chantiers', { method: 'POST', body: { code, name }, token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chantiers'] });
      setShowForm(false);
      setCode('');
      setName('');
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Échec de la création'),
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Chantiers</h1>
        {!showForm && (
          <button className="btn" onClick={() => setShowForm(true)}>
            + Nouveau chantier
          </button>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>Nouveau chantier</h2>
          {error && <div className="error">{error}</div>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!code || !name) {
                setError('Code et nom sont obligatoires.');
                return;
              }
              create.mutate();
            }}
          >
            <div className="field">
              <label>Code *</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="field">
              <label>Nom *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" type="submit" disabled={create.isPending}>
                {create.isPending ? 'Création…' : 'Créer'}
              </button>
              <button className="link" type="button" onClick={() => { setShowForm(false); setError(null); }}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Suivi de chantiers {data ? `(${data.length})` : ''}</h2>
        {isLoading && <p className="muted">Chargement…</p>}
        {isError && (
          <p className="muted">Module « Suivi de chantiers » non actif pour cet utilisateur.</p>
        )}
        {data && data.length > 0 && (
          <table className="grid">
            <thead>
              <tr>
                <th>Code</th>
                <th>Nom</th>
                <th>Budget de vente</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/chantiers/${c.id}`} className="link">
                      {c.code}
                    </Link>
                  </td>
                  <td>{c.name ?? '—'}</td>
                  <td>{euro(c.budget_vente_ht)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link href={`/chantiers/${c.id}`} className="link">
                      Tableau de bord →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.length === 0 && <p className="muted">Aucun chantier.</p>}
      </div>
    </div>
  );
}
