'use client';

import { useAuth } from '@/lib/auth';

export function Topbar() {
  const { email, tenantSlug, logout } = useAuth();
  return (
    <header className="topbar">
      <div className="muted">{tenantSlug ? `Entreprise : ${tenantSlug}` : ''}</div>
      <div className="user">
        <span>{email}</span>
        <button className="link" onClick={logout}>
          Déconnexion
        </button>
      </div>
    </header>
  );
}
