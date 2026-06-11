'use client';

import { LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export function Topbar() {
  const { email, tenantSlug, logout } = useAuth();
  return (
    <header className="topbar">
      <div className="muted" style={{ fontSize: 10.5 }}>
        {tenantSlug ? (
          <span>
            <span style={{ opacity: 0.6 }}>Entreprise</span>
            {' '}
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{tenantSlug}</span>
          </span>
        ) : ''}
      </div>
      <div className="user">
        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{email}</span>
        <button
          onClick={logout}
          title="Se déconnecter"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5,
            color: 'var(--muted)', fontSize: 11, padding: '3px 6px',
            borderRadius: 4, transition: 'color 0.12s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)'; }}
        >
          <LogOut size={13} />
          Déconnexion
        </button>
      </div>
    </header>
  );
}
