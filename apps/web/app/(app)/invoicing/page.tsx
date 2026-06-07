'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { euro } from '@/lib/format';
import { SortHeader, SortState, nextSort, applySort } from '@/components/SortHeader';

interface Marche {
  id: string;
  code: string;
  name: string;
  total_ht: string;
}

export default function InvoicingPage() {
  const { token } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['marches'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Marche[]>('/marches', { token }),
  });
  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const onSort = (k: string) => setSort((s) => nextSort(s, k));
  const marcheRows = applySort(data ?? [], sort, (m, k) => (m as unknown as Record<string, unknown>)[k]);

  return (
    <div>
      <h1>Facturation</h1>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Marchés {data ? `(${data.length})` : ''}</h2>
        {isLoading && <p className="muted">Chargement…</p>}
        {isError && (
          <p className="muted">
            Module non actif pour cet utilisateur (capacité « invoicing ») ou aucun marché.
          </p>
        )}
        {data && data.length > 0 && (
          <table className="grid">
            <thead>
              <tr>
                <SortHeader label="Code" colKey="code" sort={sort} onSort={onSort} />
                <SortHeader label="Nom" colKey="name" sort={sort} onSort={onSort} />
                <SortHeader label="Total HT" colKey="total_ht" sort={sort} onSort={onSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {marcheRows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/invoicing/${m.id}`} className="link">{m.code}</Link>
                  </td>
                  <td>{m.name}</td>
                  <td>{euro(m.total_ht)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link href={`/invoicing/${m.id}`} className="link">Situations →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.length === 0 && <p className="muted">Aucun marché.</p>}
      </div>
    </div>
  );
}
