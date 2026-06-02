'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';

interface Client {
  id: string;
  code: string;
  name: string;
}
interface ClientsPage {
  rows: Client[];
  total: number;
}

export default function DirectoryPage() {
  const { token } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['clients'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<ClientsPage>('/clients?sort=code&pageSize=50', { token }),
  });

  return (
    <div>
      <h1>Clients & fournisseurs</h1>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Clients {data ? `(${data.total})` : ''}</h2>
        {isLoading && <p className="muted">Chargement…</p>}
        {isError && <p className="muted">Accès non autorisé ou aucune donnée.</p>}
        {data && data.rows.length > 0 && (
          <table className="grid">
            <thead>
              <tr>
                <th>Code</th>
                <th>Nom</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.code}</td>
                  <td>{c.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.rows.length === 0 && <p className="muted">Aucun client.</p>}
      </div>
    </div>
  );
}
