'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
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
  const { data, isLoading, isError } = useQuery({
    queryKey: ['affaires'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<AffairesPage>('/affaires?sort=code&pageSize=50', { token }),
  });

  return (
    <div>
      <h1>Études de prix</h1>
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
