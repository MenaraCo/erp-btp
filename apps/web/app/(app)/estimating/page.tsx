'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';

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

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouverte',
  study: 'Étude en cours',
  coeffs_proposed: 'Coefficients proposés',
  coeffs_validated: 'Coefficients validés',
  sent: 'Envoyée',
  won: 'Gagnée',
  lost: 'Perdue',
  followup: 'Relancée',
  revision: 'Révision',
};

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
              </tr>
            </thead>
            <tbody>
              {data.rows.map((a) => (
                <tr key={a.id}>
                  <td>{a.code}</td>
                  <td>{a.name}</td>
                  <td>{STATUS_LABELS[a.status] ?? a.status}</td>
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
