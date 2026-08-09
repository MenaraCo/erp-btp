'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { euro } from '@/lib/format';
import { SortHeader, SortState, nextSort, applySort } from '@/components/SortHeader';
import { IconBtn } from '@/components/IconBtn';

interface Chantier {
  id: string;
  code: string;
  name?: string | null;
  budget_vente_ht: string | null;
}

export default function ChantiersPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['chantiers'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Chantier[]>('/chantiers', { token }),
  });
  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const onSort = (k: string) => setSort((s) => nextSort(s, k));
  const chantierRows = applySort(data ?? [], sort, (c, k) => (c as unknown as Record<string, unknown>)[k]);

  const create = useMutation({
    mutationFn: () => apiFetch('/chantiers', { method: 'POST', body: { name }, token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chantiers'] });
      setShowForm(false);
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
              if (!name) {
                setError('Le nom est obligatoire.');
                return;
              }
              create.mutate();
            }}
          >
            <div className="field">
              <label>Nom *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
              <span className="muted" style={{ fontSize: 11 }}>Le code chantier est attribué automatiquement.</span>
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

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        {isLoading && <p className="muted" style={{ padding: 16 }}>Chargement…</p>}
        {isError && (
          <p className="muted" style={{ padding: 16 }}>Module « Suivi de chantiers » non actif pour cet utilisateur.</p>
        )}
        {data && data.length > 0 && (
          <table className="grid" style={{ margin: 0 }}>
            <thead>
              <tr>
                <SortHeader label="Code" colKey="code" sort={sort} onSort={onSort} />
                <SortHeader label="Nom" colKey="name" sort={sort} onSort={onSort} />
                <SortHeader label="Budget de vente" colKey="budget_vente_ht" sort={sort} onSort={onSort} />
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {chantierRows.map((c) => (
                <tr
                  key={c.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => router.push(`/chantiers/${c.id}`)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                >
                  <td className="code-cell">{c.code}</td>
                  <td style={{ fontWeight: 500 }}>{c.name ?? '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{euro(c.budget_vente_ht)}</td>
                  <td style={{ textAlign: 'right', paddingRight: 8 }}>
                    <IconBtn
                      title="Tableau de bord chantier"
                      color="var(--muted)"
                      onClick={(e) => { e.stopPropagation(); router.push(`/chantiers/${c.id}`); }}
                    >
                      <LayoutDashboard size={13} />
                    </IconBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.length === 0 && (
          <p className="muted" style={{ padding: 16 }}>
            Aucun chantier. Un chantier naît d’une commande acceptée : passez par «&nbsp;
            <Link href="/acceptation" style={{ color: 'var(--accent)' }}>Acceptation de commande</Link>
            &nbsp;» pour transformer un devis gagné.
          </p>
        )}
      </div>
    </div>
  );
}
