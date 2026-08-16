'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Receipt } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { euro } from '@/lib/format';
import { SortHeader, SortState, nextSort, applySort } from '@/components/SortHeader';
import { IconBtn } from '@/components/IconBtn';
import { Alerte, EtatVide } from '@/components/ui';

interface Marche {
  id: string;
  code: string;
  name: string;
  total_ht: string;
}

export default function InvoicingPage() {
  const { token } = useAuth();
  const router = useRouter();
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
      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        {isLoading && <p className="muted" style={{ padding: 16 }}>Chargement…</p>}
        {isError && (
          <Alerte>Module non actif pour cet utilisateur (capacité « invoicing ») ou aucun marché.</Alerte>
        )}
        {data && data.length > 0 && (
          <table className="grid" style={{ margin: 0 }}>
            <thead>
              <tr>
                <SortHeader label="Code" colKey="code" sort={sort} onSort={onSort} />
                <SortHeader label="Nom" colKey="name" sort={sort} onSort={onSort} />
                <SortHeader label="Total HT" colKey="total_ht" sort={sort} onSort={onSort} />
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {marcheRows.map((m) => (
                <tr
                  key={m.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => router.push(`/invoicing/${m.id}`)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                >
                  <td className="code-cell">{m.code}</td>
                  <td style={{ fontWeight: 500 }}>{m.name}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{euro(m.total_ht)}</td>
                  <td style={{ textAlign: 'right', paddingRight: 8 }}>
                    <IconBtn
                      title="Voir les situations"
                      color="var(--muted)"
                      onClick={(e) => { e.stopPropagation(); router.push(`/invoicing/${m.id}`); }}
                    >
                      <ArrowRight size={14} />
                    </IconBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.length === 0 && (
          <EtatVide
            icone={Receipt}
            titre="Aucun marché à facturer."
            indice={(
              <>
                Un marché naît d’une commande acceptée : passez par{' '}
                <Link href="/acceptation" className="link">Acceptation de commande</Link>{' '}
                pour transformer un devis gagné.
              </>
            )}
          />
        )}
      </div>
    </div>
  );
}
