'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { euro } from '@/lib/format';

interface Chantier {
  id: string;
  code: string;
  budget_vente_ht: string | null;
  contre_etude_status: string | null;
}

const CE_LABELS: Record<string, string> = {
  draft: 'Contre-étude en cours',
  validated: 'Contre-étude validée',
};

export default function ChantiersPage() {
  const { token } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['chantiers'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Chantier[]>('/chantiers', { token }),
  });

  return (
    <div>
      <h1>Chantiers</h1>
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
                <th>Budget de vente</th>
                <th>Contre-étude</th>
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
                  <td>{euro(c.budget_vente_ht)}</td>
                  <td className="muted">
                    {c.contre_etude_status ? (CE_LABELS[c.contre_etude_status] ?? c.contre_etude_status) : '—'}
                  </td>
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
