'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS } from '@/lib/format';

interface Affaire {
  id: string;
  code: string;
  name: string;
  status: string;
}
interface AffairesPage {
  rows: Affaire[];
  total: number;
}

export default function EstimatingPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [moa, setMoa] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['affaires'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<AffairesPage>('/affaires?sort=code&pageSize=50', { token }),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ affaire: { id: string } }>('/affaires', {
        method: 'POST',
        body: { code, name, moa: moa || null },
        token,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['affaires'] });
      setShowForm(false);
      setCode('');
      setName('');
      setMoa('');
      setError(null);
      // ouvre directement le nouveau devis
      router.push(`/estimating/${res.affaire.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Échec de la création'),
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Devis</h1>
        {!showForm && (
          <button className="btn" onClick={() => setShowForm(true)}>
            + Nouveau devis
          </button>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>Nouveau devis</h2>
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
              <label>Désignation *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>MOA / client (texte libre)</label>
              <input value={moa} onChange={(e) => setMoa(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" type="submit" disabled={create.isPending}>
                {create.isPending ? 'Création…' : 'Créer le devis'}
              </button>
              <button className="link" type="button" onClick={() => { setShowForm(false); setError(null); }}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Affaires {data ? `(${data.total})` : ''}</h2>
        {isLoading && <p className="muted">Chargement…</p>}
        {isError && <p className="muted">Accès non autorisé ou aucune donnée.</p>}
        {data && data.rows.length > 0 && (
          <table className="grid">
            <thead>
              <tr>
                <th>Code</th>
                <th>Nom</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/estimating/${a.id}`} className="link">
                      {a.code}
                    </Link>
                  </td>
                  <td>{a.name}</td>
                  <td>
                    <span className="badge">{AFFAIRE_STATUS_LABELS[a.status] ?? a.status}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link href={`/estimating/${a.id}`} className="link">
                      Ouvrir le devis →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.rows.length === 0 && <p className="muted">Aucune affaire.</p>}
      </div>
    </div>
  );
}
