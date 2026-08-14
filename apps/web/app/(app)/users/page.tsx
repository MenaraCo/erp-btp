'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';

/* ─────────── types ─────────── */
interface Role { code: string; label: string; isSystem: boolean; permissions: string[] }
interface UserWithRoles { id: string; email: string; firstName: string | null; lastName: string | null; fullName: string | null; roles: string[] }
interface Seat { id: string; moduleCode: string; userId: string; email: string; fullName: string | null }

const MODULE_LABELS: Record<string, string> = {
  core: 'Socle',
  estimating: 'Études de prix',
  invoicing: 'Facturation',
  site_tracking: 'Suivi de chantiers',
  financial_management: 'Gestion financière',
  stock_equipment: 'Stocks & Parc matériel',
  bim: 'BIM / IFC',
  ai: 'Assistance IA',
  api: 'API & connecteurs',
  enterprise: 'Entreprise (multi-société, SSO)',
};
const PERMISSION_LABELS: Record<string, string> = {
  'rbac.role.manage': 'Gérer les rôles',
  'rbac.user_role.assign': 'Affecter des rôles',
  'entitlements.seat.assign': 'Affecter des jetons',
  'subscription.manage': 'Gérer la souscription',
  'directory.read': 'Consulter le référentiel',
  'directory.write': 'Modifier le référentiel',
  'estimating.devis.read': 'Consulter les devis',
  'estimating.devis.write': 'Modifier les devis',
  'invoicing.read': 'Consulter la facturation',
  'invoicing.write': 'Gérer la facturation',
  'site_tracking.read': 'Consulter le suivi de chantiers',
  'site_tracking.write': 'Gérer le suivi de chantiers',
  'financial.read': 'Consulter la gestion financière',
  'financial.write': 'Paramétrer la gestion financière',
};

/**
 * Console Utilisateurs & rôles (cahier §3.2). Deux axes orthogonaux :
 *  - Rôles = ce qu'un utilisateur a le droit de faire (permissions RBAC).
 *  - Jetons = à quels modules il accède (gérés dans Abonnement).
 */
export default function UsersPage() {
  const { token } = useAuth();
  const qc = useQueryClient();

  const users = useQuery({
    queryKey: ['admin-users'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<UserWithRoles[]>('/admin/users', { token }),
  });
  const roles = useQuery({
    queryKey: ['roles'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Role[]>('/roles', { token }),
  });
  const seats = useQuery({
    queryKey: ['seats'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Seat[]>('/seats', { token }),
  });

  const seatsByUser = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of seats.data ?? []) {
      const list = map.get(s.userId) ?? [];
      list.push(s.moduleCode);
      map.set(s.userId, list);
    }
    return map;
  }, [seats.data]);

  const toggleRole = useMutation({
    mutationFn: ({ userId, roleCode, has }: { userId: string; roleCode: string; has: boolean }) =>
      has
        ? apiFetch(`/admin/users/${userId}/roles/${roleCode}`, { method: 'DELETE', token })
        : apiFetch(`/admin/users/${userId}/roles`, { method: 'POST', token, body: { roleCode } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  if (users.isError) {
    const forbidden = users.error instanceof ApiError && users.error.status === 403;
    return (
      <div>
        <h1>Utilisateurs & rôles</h1>
        <p className="muted">
          {forbidden
            ? 'Réservé aux administrateurs de la société (permission « Affecter des rôles » requise).'
            : 'Accès indisponible.'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Utilisateurs & rôles</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Deux droits distincts par utilisateur : les <strong>rôles</strong> déterminent ce qu'il a le droit de faire
        (consulter, modifier, gérer) ; l'<strong>accès aux modules</strong> dépend des <strong>jetons</strong>, gérés
        dans <Link href="/abonnement" className="link">Abonnement</Link>. Les deux doivent être accordés pour agir
        dans un module.
      </p>

      <div className="card" style={{ marginTop: 12, padding: 0, overflow: 'hidden' }}>
        {users.isLoading && <p className="muted" style={{ padding: 16 }}>Chargement…</p>}
        {users.data && (
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ margin: 0, minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Rôles (droits d'action)</th>
                  <th>Accès modules (jetons)</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.fullName ?? u.email}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{u.email}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(roles.data ?? []).map((r) => {
                          const has = u.roles.includes(r.code);
                          return (
                            <button
                              key={r.code}
                              type="button"
                              title={r.permissions.map((p) => PERMISSION_LABELS[p] ?? p).join(', ')}
                              disabled={toggleRole.isPending}
                              onClick={() => toggleRole.mutate({ userId: u.id, roleCode: r.code, has })}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '3px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 12,
                                border: has ? '1px solid var(--primary)' : '1px solid var(--border)',
                                background: has ? 'var(--primary)' : 'transparent',
                                color: has ? '#fff' : 'var(--muted)',
                              }}
                            >
                              {has && <Check size={12} />} {r.label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {(seatsByUser.get(u.id) ?? []).length === 0 ? (
                          <span className="muted" style={{ fontSize: 12 }}>Aucun module</span>
                        ) : (
                          (seatsByUser.get(u.id) ?? []).map((code) => (
                            <span key={code} className="badge" style={{ fontSize: 11 }}>
                              {MODULE_LABELS[code] ?? code}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        Cliquez un rôle pour l'accorder ou le retirer (les rôles se cumulent). Pour donner accès à un module,
        affectez un jeton dans <Link href="/abonnement" className="link">Abonnement → Modules & jetons</Link>.
      </p>

      <RolesLegend roles={roles.data ?? []} />
      <CreateUser roles={roles.data ?? []} token={token} onCreated={() => {
        qc.invalidateQueries({ queryKey: ['admin-users'] });
      }} />
    </div>
  );
}

/* ─────────── légende des rôles ─────────── */
function RolesLegend({ roles }: { roles: Role[] }) {
  if (roles.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={16} /> Que permet chaque rôle
      </h2>
      <div style={{ display: 'grid', gap: 10 }}>
        {roles.map((r) => (
          <div key={r.code} style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong style={{ minWidth: 120 }}>{r.label}</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {r.permissions.map((p) => PERMISSION_LABELS[p] ?? p).join(' · ')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────── création d'utilisateur ─────────── */
function CreateUser({ roles, token, onCreated }: { roles: Role[]; token: string | null; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [roleCode, setRoleCode] = useState('estimator');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/admin/users', {
        method: 'POST', token,
        body: {
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          password,
          roleCode: roleCode || null,
        },
      }),
    onSuccess: () => {
      setErr(null); setOk(true);
      setEmail(''); setFirstName(''); setLastName(''); setPassword('');
      onCreated();
      setTimeout(() => setOk(false), 3000);
    },
    onError: (e) => { setOk(false); setErr(e instanceof ApiError ? e.message : 'Erreur'); },
  });

  const valid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    firstName.trim() !== '' && lastName.trim() !== '' && password.length >= 8;

  return (
    <div className="card" style={{ marginTop: 16, maxWidth: 720 }}>
      <h2 style={{ marginTop: 0 }}>Ajouter un utilisateur</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Crée un compte pour un collaborateur de la société avec un mot de passe initial (min. 8 caractères), qu'il
        pourra changer. Pensez ensuite à lui affecter un jeton par module dans Abonnement.
      </p>
      {err && <div className="error">{err}</div>}
      {ok && <div className="badge success" style={{ marginBottom: 8 }}>Utilisateur créé</div>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Prénom</label>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Marie" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Nom</label>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Deviseur" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>E-mail</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="marie@societe.fr" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Mot de passe initial</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8 caractères min." />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Rôle initial</label>
          <select value={roleCode} onChange={(e) => setRoleCode(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">— Aucun —</option>
            {roles.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </div>
        <button className="btn" disabled={!valid || create.isPending} onClick={() => { setErr(null); create.mutate(); }}>
          {create.isPending ? 'Création…' : 'Créer l\'utilisateur'}
        </button>
      </div>
    </div>
  );
}
