'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';

interface Paginated {
  total: number;
}

function useCount(path: string, token: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['count', path],
    enabled,
    queryFn: () => apiFetch<Paginated>(path, { token }),
  });
}

export default function DashboardPage() {
  const { token, email } = useAuth();
  const affaires = useCount('/affaires?pageSize=1', token, Boolean(token));
  const clients = useCount('/clients?pageSize=1', token, Boolean(token));

  return (
    <div>
      <h1>Tableau de bord</h1>
      <p className="muted">Bienvenue, {email}.</p>

      <div className="card-grid" style={{ marginTop: 20 }}>
        <div className="card">
          <h2>Affaires</h2>
          <div className="stat">{affaires.isLoading ? '…' : (affaires.data?.total ?? '—')}</div>
          <div className="muted">Études de prix</div>
        </div>
        <div className="card">
          <h2>Clients</h2>
          <div className="stat">{clients.isLoading ? '…' : (clients.data?.total ?? '—')}</div>
          <div className="muted">Référentiel</div>
        </div>
        <div className="card">
          <h2>Facturation</h2>
          <div className="stat">—</div>
          <div className="muted">Marchés & situations</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>État du socle</h2>
        <p className="muted">
          Connecté à l’API ({affaires.isError ? 'accès limité pour cet utilisateur' : 'OK'}).
          Multi-tenant, capacités/jetons, RBAC et authentification sont actifs côté serveur.
        </p>
      </div>
    </div>
  );
}
