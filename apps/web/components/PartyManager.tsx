'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { usePermissions } from '@/lib/capabilities';
import { SortHeader, SortState, nextSort, applySort } from './SortHeader';
import { IconBtn } from './IconBtn';
import { Party as PartyFiche, PartyModal } from './PartyModal';

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
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: [resource],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Page>(`/${resource}?sort=code&pageSize=100`, { token }),
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

  // `undefined` = fenêtre fermée, `null` = création, une fiche = modification.
  const [fiche, setFiche] = useState<Party | null | undefined>(undefined);

  const rawRows = list.data?.rows ?? [];
  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const rows = applySort(rawRows, sort, (p, k) => (p as unknown as Record<string, unknown>)[k]);
  const onSort = (k: string) => setSort((s) => nextSort(s, k));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{title}</h1>
        {peutEcrire && (
          <button className="btn" onClick={() => { setError(null); setFiche(null); }}>
            + Nouveau {singular}
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}

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
                        <IconBtn title={`Modifier ${p.name}`} color="#64748b" onClick={() => setFiche(p)}>
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

      {fiche !== undefined && (
        <PartyModal
          resource={resource as 'clients' | 'suppliers'}
          singular={singular}
          party={fiche as PartyFiche | null}
          onClose={() => setFiche(undefined)}
        />
      )}
    </div>
  );
}
