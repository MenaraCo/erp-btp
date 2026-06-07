'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { AFFAIRE_STATUS_LABELS } from '@/lib/format';
import { SortHeader, SortState, nextSort, applySort } from '@/components/SortHeader';

interface DevisRow {
  id: string;
  numero: string | null;
  designation: string;
  type: string;
  status: string;
  affaire_id: string;
  affaire_code: string;
  affaire_name: string;
}

const TYPE_LABELS: Record<string, string> = { principal: 'Principal', lot: 'Lot', avenant: 'Avenant' };
const devisBadge = (s: string) =>
  s === 'won' ? 'badge success' : s === 'lost' ? 'badge danger'
    : s === 'sent' || s === 'coeffs_validated' ? 'badge info' : 'badge';

export default function DevisListPage() {
  const { token } = useAuth();
  const list = useQuery({
    queryKey: ['devis-list'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<DevisRow[]>('/devis', { token }),
  });
  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const onSort = (k: string) => setSort((s) => nextSort(s, k));
  const rows = applySort(list.data ?? [], sort, (d, k) => (d as unknown as Record<string, unknown>)[k]);

  return (
    <div>
      <h1>Devis</h1>
      <p className="muted" style={{ marginTop: 0 }}>Tous les devis, toutes affaires confondues.</p>

      <div className="card" style={{ marginTop: 12 }}>
        {list.isError && <p className="muted">Accès non autorisé.</p>}
        {list.data && list.data.length > 0 ? (
          <table className="grid">
            <thead><tr>
              <SortHeader label="Numéro" colKey="numero" sort={sort} onSort={onSort} />
              <SortHeader label="Désignation" colKey="designation" sort={sort} onSort={onSort} />
              <SortHeader label="Affaire" colKey="affaire_code" sort={sort} onSort={onSort} />
              <SortHeader label="Type" colKey="type" sort={sort} onSort={onSort} />
              <SortHeader label="Statut" colKey="status" sort={sort} onSort={onSort} />
              <th />
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="code-cell">{d.numero ?? '—'}</td>
                  <td>{d.designation}</td>
                  <td className="muted">{d.affaire_code} — {d.affaire_name}</td>
                  <td className="muted">{TYPE_LABELS[d.type] ?? d.type}</td>
                  <td><span className={devisBadge(d.status)}>{AFFAIRE_STATUS_LABELS[d.status] ?? d.status}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="link" href={`/estimating/${d.affaire_id}/devis/${d.id}`}>Ouvrir →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : list.data ? (
          <p className="muted">Aucun devis. Créez une affaire pour démarrer.</p>
        ) : (
          <p className="muted">Chargement…</p>
        )}
      </div>
    </div>
  );
}
