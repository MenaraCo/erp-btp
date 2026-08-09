'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { usePermissions } from '@/lib/capabilities';
import { SortHeader, SortState, nextSort, applySort } from './SortHeader';
import { IconBtn } from './IconBtn';
import { CompanySearch } from './CompanySearch';

interface Party {
  id: string;
  code: string;
  name: string;
  vat_number?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Fournisseurs seulement : `a_valider` pour une fiche proposée depuis un chantier. */
  statut?: 'valide' | 'a_valider' | null;
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
  // Écrire dans le référentiel exige `directory.write` : sans lui, la liste reste consultable
  // mais aucune action de création, modification ou suppression n'est proposée.
  const peutEcrire = usePermissions().canOrLoading('directory.write');
  // Régulariser une fiche proposée depuis le terrain. La société décide qui porte ce droit :
  // ce peut être le deviseur, la secrétaire, le directeur… d'où une permission dédiée.
  const peutValider = usePermissions().can('directory.validate');
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
    onError: (e) => setError(e instanceof ApiError ? e.message : "Échec de l'enregistrement"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/${resource}/${id}`, { method: 'DELETE', token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [resource] }),
  });

  const valider = useMutation({
    mutationFn: (id: string) => apiFetch(`/${resource}/${id}/valider`, { method: 'POST', token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [resource] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Validation impossible.'),
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
        {!showForm && peutEcrire && (
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
              if (!form.name) {
                setError('Le nom est obligatoire.');
                return;
              }
              save.mutate();
            }}
          >
            <div className="field">
              <CompanySearch
                label={`Rechercher le ${singular} (annuaire officiel)`}
                onSelect={(c) => setForm((prev) => ({
                  ...prev,
                  name: c.name,
                  vatNumber: c.vatIntra ?? prev.vatNumber,
                }))}
              />
            </div>
            {editingId && (
              <div className="field">
                <label>Code</label>
                <input value={form.code} disabled title="Attribué automatiquement" />
              </div>
            )}
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

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        {list.isLoading && <p className="muted" style={{ padding: 16 }}>Chargement…</p>}
        {list.isError && <p className="muted" style={{ padding: 16 }}>Accès non autorisé ou aucune donnée.</p>}
        {rows.length > 0 && (
          <table className="grid" style={{ margin: 0 }}>
            <thead>
              <tr>
                <SortHeader label="Code" colKey="code" sort={sort} onSort={onSort} />
                <SortHeader label="Nom" colKey="name" sort={sort} onSort={onSort} />
                <SortHeader label="E-mail" colKey="email" sort={sort} onSort={onSort} />
                <SortHeader label="Téléphone" colKey="phone" sort={sort} onSort={onSort} />
                <th style={{ width: 64 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="code-cell">{p.code}</td>
                  <td style={{ fontWeight: 500 }}>
                    {p.name}
                    {/* Une fiche proposée depuis un chantier reste utilisable, mais elle se
                        signale partout où elle apparaît jusqu'à sa régularisation. */}
                    {p.statut === 'a_valider' && (
                      <span className="badge warning" style={{ marginLeft: 8 }} title="Fiche proposée depuis un chantier, en attente de validation">
                        À valider
                      </span>
                    )}
                  </td>
                  <td className="muted">{p.email ?? '—'}</td>
                  <td className="muted">{p.phone ?? '—'}</td>
                  <td style={{ textAlign: 'right', paddingRight: 8 }}>
                    {p.statut === 'a_valider' && peutValider && (
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '2px 10px', fontSize: 10.5, marginRight: 6 }}
                        disabled={valider.isPending}
                        onClick={() => { setError(null); valider.mutate(p.id); }}
                      >
                        Valider
                      </button>
                    )}
                    {peutEcrire && (
                      <>
                        <IconBtn title={`Modifier ${p.name}`} color="#64748b" onClick={() => startEdit(p)}>
                          <Pencil size={13} />
                        </IconBtn>
                        <IconBtn
                          title={`Supprimer ${p.name}`}
                          color="#dc2626"
                          onClick={() => { if (confirm(`Supprimer ${p.name} ?`)) remove.mutate(p.id); }}
                        >
                          <Trash2 size={12} />
                        </IconBtn>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {list.data && rows.length === 0 && <p className="muted" style={{ padding: 16 }}>Aucun {singular}.</p>}
      </div>
    </div>
  );
}
