'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { SortHeader, SortState, nextSort, applySort } from './SortHeader';

interface Party {
  id: string;
  code: string;
  name: string;
  vat_number?: string | null;
  email?: string | null;
  phone?: string | null;
}
interface Page {
  rows: Party[];
  total: number;
}
interface FormState {
  code: string;
  name: string;
  vatNumber: string;
  email: string;
  phone: string;
}
const EMPTY: FormState = { code: '', name: '', vatNumber: '', email: '', phone: '' };

/**
 * Generic CRUD screen for a "party" resource (clients or suppliers): list + create/edit form +
 * soft delete. Every action hits the real API and refreshes the list via query invalidation.
 */
export function PartyManager({
  resource,
  title,
  singular,
}: {
  resource: 'clients' | 'suppliers';
  title: string;
  singular: string;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: [resource],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Page>(`/${resource}?sort=code&pageSize=100`, { token }),
  });

  function reset() {
    setForm(EMPTY);
    setEditingId(null);
    setShowForm(false);
    setError(null);
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code,
        name: form.name,
        vatNumber: form.vatNumber || null,
        email: form.email || null,
        phone: form.phone || null,
      };
      return editingId
        ? apiFetch(`/${resource}/${editingId}`, { method: 'PATCH', body, token })
        : apiFetch(`/${resource}`, { method: 'POST', body, token });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [resource] });
      reset();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Échec de l’enregistrement'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/${resource}/${id}`, { method: 'DELETE', token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [resource] }),
  });

  function startCreate() {
    setForm(EMPTY);
    setEditingId(null);
    setError(null);
    setShowForm(true);
  }
  function startEdit(p: Party) {
    setForm({
      code: p.code,
      name: p.name,
      vatNumber: p.vat_number ?? '',
      email: p.email ?? '',
      phone: p.phone ?? '',
    });
    setEditingId(p.id);
    setError(null);
    setShowForm(true);
  }

  const rawRows = list.data?.rows ?? [];
  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const rows = applySort(rawRows, sort, (p, k) => (p as unknown as Record<string, unknown>)[k]);
  const onSort = (k: string) => setSort((s) => nextSort(s, k));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{title}</h1>
        {!showForm && (
          <button className="btn" onClick={startCreate}>
            + Nouveau {singular}
          </button>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>{editingId ? `Modifier le ${singular}` : `Nouveau ${singular}`}</h2>
          {error && <div className="error">{error}</div>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.code || !form.name) {
                setError('Code et nom sont obligatoires.');
                return;
              }
              save.mutate();
            }}
          >
            <div className="field">
              <label>Code *</label>
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div className="field">
              <label>Nom *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label>N° TVA</label>
              <input value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} />
            </div>
            <div className="field">
              <label>E-mail</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="field">
              <label>Téléphone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" type="submit" disabled={save.isPending}>
                {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button className="link" type="button" onClick={reset}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Liste {list.data ? `(${list.data.total})` : ''}</h2>
        {list.isLoading && <p className="muted">Chargement…</p>}
        {list.isError && <p className="muted">Accès non autorisé ou aucune donnée.</p>}
        {rows.length > 0 && (
          <table className="grid">
            <thead>
              <tr>
                <SortHeader label="Code" colKey="code" sort={sort} onSort={onSort} />
                <SortHeader label="Nom" colKey="name" sort={sort} onSort={onSort} />
                <SortHeader label="E-mail" colKey="email" sort={sort} onSort={onSort} />
                <SortHeader label="Téléphone" colKey="phone" sort={sort} onSort={onSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td>{p.name}</td>
                  <td>{p.email ?? '—'}</td>
                  <td>{p.phone ?? '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="link" onClick={() => startEdit(p)}>
                      Modifier
                    </button>
                    {' · '}
                    <button
                      className="link"
                      onClick={() => {
                        if (confirm(`Supprimer ${p.name} ?`)) remove.mutate(p.id);
                      }}
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {list.data && rows.length === 0 && <p className="muted">Aucun {singular}.</p>}
      </div>
    </div>
  );
}
