'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { moduleLabel } from '@/lib/modules';

/* ─────────── types ─────────── */
interface Role { code: string; label: string; isSystem: boolean; permissions: string[] }
interface UserWithRoles { id: string; email: string; firstName: string | null; lastName: string | null; fullName: string | null; jobTitle: string | null; roles: string[] }
interface Seat { id: string; moduleCode: string; userId: string; email: string; fullName: string | null }
interface Permission { key: string; label: string }


/**
 * Console Utilisateurs & rôles (cahier §3.2). Deux axes orthogonaux :
 *  - Rôles = ce qu'un utilisateur a le droit de faire (permissions RBAC).
 *  - Jetons = à quels modules il accède (gérés dans Abonnement).
 */
export default function UsersPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  // Un changement de profil prend effet immédiatement : on le fait CONFIRMER plutôt que de
  // l'appliquer au premier clic dans la liste, où une fausse manœuvre retire des droits.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [roleErr, setRoleErr] = useState<string | null>(null);

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
  // Libellés servis par l'API : une permission ajoutée côté serveur s'affiche ici sans retouche,
  // au lieu de sortir en clé technique.
  const permissions = useQuery({
    queryKey: ['permissions'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Permission[]>('/permissions', { token }),
  });
  const seats = useQuery({
    queryKey: ['seats'],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => apiFetch<Seat[]>('/seats', { token }),
  });

  const permissionLabel = useMemo(() => {
    const map = new Map((permissions.data ?? []).map((p) => [p.key, p.label]));
    return (key: string) => map.get(key) ?? key;
  }, [permissions.data]);

  const seatsByUser = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of seats.data ?? []) {
      const list = map.get(s.userId) ?? [];
      list.push(s.moduleCode);
      map.set(s.userId, list);
    }
    return map;
  }, [seats.data]);

  // Un profil À LA FOIS : le serveur remplace l'ancien dans la même transaction.
  const setRole = useMutation({
    mutationFn: ({ userId, roleCode }: { userId: string; roleCode: string | null }) =>
      apiFetch(`/admin/users/${userId}/role`, { method: 'POST', token, body: { roleCode } }),
    onSuccess: (_r, v) => {
      setRoleErr(null);
      setPending((p) => { const n = { ...p }; delete n[v.userId]; return n; });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    // Le serveur refuse notamment de retirer le dernier administrateur : on montre sa phrase.
    onError: (e) => setRoleErr(e instanceof ApiError ? e.message : 'Changement impossible'),
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
        Chaque personne a deux choses distinctes : un <strong>profil</strong>, qui dit ce qu'elle a le droit
        de faire (consulter, modifier, gérer), et des <strong>jetons</strong>, qui disent à quels modules elle
        accède — attribués dans <Link href="/abonnement" className="link">Abonnement</Link>. Il faut les deux
        pour travailler dans un module.
      </p>

      {roleErr && <div className="error" style={{ marginTop: 12 }}>{roleErr}</div>}

      <div className="card" style={{ marginTop: 12, padding: 0, overflow: 'hidden' }}>
        {users.isLoading && <p className="muted" style={{ padding: 16 }}>Chargement…</p>}
        {users.data && (
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ margin: 0, minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Profil (droits d'action)</th>
                  <th>Accès modules (jetons)</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.fullName ?? u.email}</div>
                      {u.jobTitle && (
                        <div className="muted" style={{ fontSize: 12 }}>{u.jobTitle}</div>
                      )}
                      <div className="muted" style={{ fontSize: 12 }}>{u.email}</div>
                    </td>
                    <td>
                      {(() => {
                        const courant = u.roles[0] ?? '';
                        const choisi = pending[u.id] ?? courant;
                        const enAttente = choisi !== courant;
                        const role = (roles.data ?? []).find((r) => r.code === choisi);
                        return (
                          <div>
                            <select
                              value={choisi}
                              disabled={setRole.isPending}
                              onChange={(e) => {
                                setRoleErr(null);
                                setPending((p) => ({ ...p, [u.id]: e.target.value }));
                              }}
                              style={{ minWidth: 200 }}
                            >
                              <option value="">— Aucun droit —</option>
                              {(roles.data ?? []).map((r) => (
                                <option key={r.code} value={r.code}>{r.label}</option>
                              ))}
                            </select>
                            {enAttente && (
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                                <button
                                  className="btn"
                                  style={{ padding: '3px 10px', fontSize: 12 }}
                                  disabled={setRole.isPending}
                                  onClick={() =>
                                    setRole.mutate({ userId: u.id, roleCode: choisi || null })
                                  }
                                >
                                  {setRole.isPending ? '…' : 'Appliquer'}
                                </button>
                                <button
                                  className="link"
                                  type="button"
                                  onClick={() => {
                                    setRoleErr(null);
                                    setPending((p) => { const n = { ...p }; delete n[u.id]; return n; });
                                  }}
                                >
                                  Annuler
                                </button>
                              </div>
                            )}
                            {/* Comptes hérités du temps où les rôles se cumulaient : la liste n'en
                                montre qu'un. On le dit, car choisir un profil retirera les autres. */}
                            {u.roles.length > 1 && (
                              <div style={{ fontSize: 11, marginTop: 4, color: 'var(--accent)' }}>
                                Cumule {u.roles.length} rôles ; choisir un profil ne gardera que celui-ci.
                              </div>
                            )}
                            {/* Le détail de chaque profil est donné UNE fois, dans la légende en bas
                                de page : le répéter sous chaque personne allongeait le tableau sans
                                rien apprendre. Ne reste ici que ce qui concerne CETTE personne. */}
                            {!role && (
                              <div className="muted" style={{ fontSize: 11, marginTop: 4, maxWidth: 320 }}>
                                Cet utilisateur ne peut rien faire tant qu’aucun profil ne lui est attribué.
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {(seatsByUser.get(u.id) ?? []).length === 0 ? (
                          <span className="muted" style={{ fontSize: 12 }}>Aucun module</span>
                        ) : (
                          (seatsByUser.get(u.id) ?? []).map((code) => (
                            <span key={code} className="badge" style={{ fontSize: 11 }}>
                              {moduleLabel(code)}
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
        Choisissez un profil par personne, puis confirmez par « Appliquer » : il décide de ce qu'elle
        a le droit de faire. Pour lui ouvrir
        un module, affectez-lui un jeton dans{' '}
        <Link href="/abonnement" className="link">Abonnement → Formule & Options</Link>.
      </p>

      <RolesLegend roles={roles.data ?? []} permissionLabel={permissionLabel} />
      <CreateUser roles={roles.data ?? []} token={token} onCreated={() => {
        qc.invalidateQueries({ queryKey: ['admin-users'] });
      }} />
    </div>
  );
}

/* ─────────── légende des rôles ─────────── */
function RolesLegend({
  roles,
  permissionLabel,
}: {
  roles: Role[];
  permissionLabel: (key: string) => string;
}) {
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
              {r.permissions.map(permissionLabel).join(' · ')}
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
  const [jobTitle, setJobTitle] = useState('');
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
          jobTitle: jobTitle.trim() || null,
          password,
          roleCode: roleCode || null,
        },
      }),
    onSuccess: () => {
      setErr(null); setOk(true);
      setEmail(''); setFirstName(''); setLastName(''); setJobTitle(''); setPassword('');
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
          <label>Fonction</label>
          <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Conducteur de travaux" />
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
