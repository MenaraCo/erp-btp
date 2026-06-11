'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS } from '@/lib/format';
import { SortHeader, SortState, nextSort, applySort } from '@/components/SortHeader';
import { IconBtn } from '@/components/IconBtn';

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

const AFFAIRE_BADGE: Record<string, string> = {
  gagnee: 'badge success',
  perdue: 'badge danger',
  gagnee_partielle: 'badge info',
};

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
  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const onSort = (k: string) => setSort((s) => nextSort(s, k));
  const affaireRows = applySort(data?.rows ?? [], sort, (a, k) => (a as unknown as Record<string, unknown>)[k]);

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
      router.push(`/estimating/${res.affaire.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Échec de la création'),
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Affaires</h1>
        {!showForm && (
          <button className="btn" onClick={() => setShowForm(true)}>
            + Nouvelle affaire
          </button>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>Nouvelle affaire</h2>
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
                {create.isPending ? 'Création…' : "Créer l'affaire"}
              </button>
              <button className="link" type="button" onClick={() => { setShowForm(false); setError(null); }}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        {isLoading && <p className="muted" style={{ padding: 16 }}>Chargement…</p>}
        {isError && <p className="muted" style={{ padding: 16 }}>Accès non autorisé ou aucune donnée.</p>}
        {data && data.rows.length > 0 && (
          <table className="grid" style={{ margin: 0 }}>
            <thead>
              <tr>
                <SortHeader label="Code" colKey="code" sort={sort} onSort={onSort} />
                <SortHeader label="Désignation" colKey="name" sort={sort} onSort={onSort} />
                <SortHeader label="Statut" colKey="status" sort={sort} onSort={onSort} />
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {affaireRows.map((a) => (
                <tr
                  key={a.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => router.push(`/estimating/${a.id}`)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                >
                  <td className="code-cell">{a.code}</td>
                  <td style={{ fontWeight: 500 }}>{a.name}</td>
                  <td>
                    <span className={AFFAIRE_BADGE[a.status] ?? 'badge'}>
                      {AFFAIRE_STATUS_LABELS[a.status] ?? a.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: 8 }}>
                    <IconBtn
                      title="Ouvrir l'affaire"
                      color="var(--muted)"
                      onClick={(e) => { e.stopPropagation(); router.push(`/estimating/${a.id}`); }}
                    >
                      <ArrowRight size={14} />
                    </IconBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.rows.length === 0 && <p className="muted" style={{ padding: 16 }}>Aucune affaire.</p>}
      </div>
    </div>
  );
}
