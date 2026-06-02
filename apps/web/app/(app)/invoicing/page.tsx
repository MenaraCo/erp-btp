'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';

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
                <th>Code</th>
                <th>Nom</th>
                <th>Total HT</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td>{m.code}</td>
                  <td>{m.name}</td>
                  <td>{m.total_ht} €</td>
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
