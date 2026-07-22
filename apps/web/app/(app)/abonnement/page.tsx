'use client';

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';

/* ─────────── types ─────────── */
interface Subscription {
  id: string;
  status: 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}
interface CatalogModule {
  code: string;
  label: string;
  isAddon: boolean;
  active: boolean;
  priceMonthly: number | null;
  description: string | null;
}
interface PackRow {
  code: string;
  label: string;
  tierLevel: number;
  priceMonthly: number | null;
  modules: string[];
}
interface PackState {
  packCode: string | null;
  packLabel: string | null;
  tierLevel: number | null;
  packSeats: number;
  addons: Array<{ code: string; label: string; seats: number }>;
}
interface AddonRow {
  code: string;
  label: string;
  priceMonthly: number | null;
  minTierLevel: number | null;
  seats: number;
  eligible: boolean;
}
interface SubscribedModule {
  moduleCode: string;
  seatsPurchased: number;
  seatsAssigned: number;
  active: boolean;
  readOnly: boolean;
}
interface TenantUser {
  id: string;
  email: string;
  fullName: string | null;
}
interface SeatAssignment {
  id: string;
  moduleCode: string;
  userId: string;
  email: string;
  fullName: string | null;
  assignedAt: string;
}

/* ─────────── helpers ─────────── */
const STATUS_LABELS: Record<Subscription['status'], string> = {
  trialing: 'Essai en cours',
  active: 'Abonnement actif',
  past_due: 'Paiement en attente',
  paused: 'En pause',
  canceled: 'Résilié',
};
const STATUS_BADGE: Record<Subscription['status'], string> = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  paused: 'warning',
  canceled: 'danger',
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

function useApi() {
  const { token } = useAuth();
  return useCallback(
    <T = unknown>(path: string, opts: Parameters<typeof apiFetch>[1] = {}) =>
      apiFetch<T>(path, { ...opts, token }),
    [token],
  );
}

/* ═══════════════════════════════════════════════════════════ */
const TABS = ['État', 'Formule & Options'] as const;
type Tab = (typeof TABS)[number];

export default function AbonnementPage() {
  const [tab, setTab] = useState<Tab>('État');
  const { token } = useAuth();

  return (
    <div style={{ padding: '20px 24px', maxWidth: 960 }}>
      <h1 style={{ margin: '0 0 4px' }}>Abonnement</h1>
      <p className="muted" style={{ margin: '0 0 20px' }}>
        État de votre souscription, modules et affectation des jetons
      </p>

      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 24 }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none', padding: '8px 16px', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: tab === t ? 'var(--primary)' : 'var(--muted)',
              borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: -2, whiteSpace: 'nowrap',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {token && tab === 'État' && <TabEtat />}
      {token && tab === 'Formule & Options' && <TabModules />}
    </div>
  );
}

/* ─────────── Onglet État ─────────── */
function TabEtat() {
  const api = useApi();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const sub = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api<Subscription | null>('/subscription'),
  });
  const modules = useQuery({
    queryKey: ['subscription-modules'],
    queryFn: () => api<SubscribedModule[]>('/subscription/modules'),
  });

  const cancel = useMutation({
    mutationFn: (cancelFlag: boolean) =>
      api('/subscription/cancel', { method: 'POST', body: { cancel: cancelFlag } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscription'] }),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  if (sub.isLoading) return <p className="muted">Chargement…</p>;
  if (sub.isError) return <p className="muted">Accès non autorisé (permission « subscription.manage »).</p>;

  const s = sub.data;
  if (!s) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Aucune souscription active pour ce tenant. Démarrez un essai ou choisissez un abonnement
          depuis l’onglet « Modules & Jetons ».
        </p>
      </div>
    );
  }

  const trialDays = s.status === 'trialing' ? daysUntil(s.trialEndsAt) : null;
  const periodDays = daysUntil(s.currentPeriodEnd);
  const activeModules = (modules.data ?? []).filter((m) => m.active);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {err && <div className="error">{err}</div>}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span className={`badge ${STATUS_BADGE[s.status]}`}>{STATUS_LABELS[s.status]}</span>
          {s.cancelAtPeriodEnd && <span className="badge warning">Résiliation programmée</span>}
        </div>

        {s.status === 'trialing' && trialDays !== null && (
          <p style={{ margin: '0 0 8px' }}>
            <strong>{trialDays > 0 ? `${trialDays} jour${trialDays > 1 ? 's' : ''} restant${trialDays > 1 ? 's' : ''}` : 'Dernier jour'}</strong>{' '}
            <span className="muted">
              — l’essai donne accès à tous les modules. Sans action, la souscription bascule
              automatiquement sur l’abonnement de premier niveau à l’échéance.
            </span>
          </p>
        )}

        {s.currentPeriodEnd && (
          <p className="muted" style={{ margin: '0 0 8px' }}>
            Période en cours jusqu’au {new Date(s.currentPeriodEnd).toLocaleDateString('fr-FR')}
            {periodDays !== null && periodDays >= 0 ? ` (${periodDays} j)` : ''}.
          </p>
        )}

        <div style={{ marginTop: 12 }}>
          {s.cancelAtPeriodEnd ? (
            <button className="btn btn-secondary" onClick={() => { setErr(null); cancel.mutate(false); }} disabled={cancel.isPending}>
              Annuler la résiliation
            </button>
          ) : (
            s.status !== 'canceled' && (
              <button className="btn btn-danger" onClick={() => { setErr(null); cancel.mutate(true); }} disabled={cancel.isPending}>
                Résilier à la fin de la période
              </button>
            )
          )}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Modules actifs ({activeModules.length})</h2>
        {activeModules.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Aucun module actif.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {activeModules.map((m) => (
              <li key={m.moduleCode} style={{ marginBottom: 4 }}>
                <strong>{m.moduleCode}</strong> — {m.seatsAssigned}/{m.seatsPurchased} jetons affectés
                {m.readOnly && <span className="badge warning" style={{ marginLeft: 8 }}>lecture seule</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ─────────── Onglet Modules & Jetons ─────────── */
function TabModules() {
  const api = useApi();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [seatDraft, setSeatDraft] = useState<string>('');
  const [addonDraft, setAddonDraft] = useState<Record<string, string>>({});

  const packs = useQuery({
    queryKey: ['sub-packs'],
    queryFn: () => api<PackRow[]>('/subscription/packs'),
  });
  const state = useQuery({
    queryKey: ['sub-pack-state'],
    queryFn: () => api<PackState>('/subscription/pack'),
  });
  const addons = useQuery({
    queryKey: ['sub-addons'],
    queryFn: () => api<AddonRow[]>('/subscription/addons'),
  });
  const catalog = useQuery({
    queryKey: ['catalog-modules'],
    queryFn: () => api<CatalogModule[]>('/catalog/modules'),
  });

  const moduleLabels = useMemo(
    () => new Map((catalog.data ?? []).map((m) => [m.code, m.label])),
    [catalog.data],
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sub-pack-state'] });
    qc.invalidateQueries({ queryKey: ['sub-addons'] });
    qc.invalidateQueries({ queryKey: ['subscription-modules'] });
    qc.invalidateQueries({ queryKey: ['subscription'] });
    qc.invalidateQueries({ queryKey: ['seats'] });
  };

  const changePack = useMutation({
    mutationFn: (v: { packCode: string; seats: number }) =>
      api('/subscription/pack', { method: 'POST', body: v }),
    onSuccess: () => { setErr(null); refresh(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });
  const changeAddon = useMutation({
    mutationFn: (v: { moduleCode: string; seats: number }) =>
      api('/subscription/addon', { method: 'POST', body: v }),
    onSuccess: () => { setErr(null); refresh(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  if (packs.isLoading || state.isLoading) return <p className="muted">Chargement…</p>;
  if (packs.isError) return <p className="muted">Accès non autorisé (permission « subscription.manage »).</p>;

  const st = state.data;
  const currentTier = st?.tierLevel ?? 0;
  const seats = seatDraft !== '' ? seatDraft : String(st?.packSeats || 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {err && <div className="error">{err}</div>}

      {/* Palier actuel */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Votre formule</h2>
        {st?.packCode ? (
          <p style={{ marginTop: 0 }}>
            <strong>{st.packLabel}</strong>{' '}
            <span className="muted">· {st.packSeats} jeton{st.packSeats > 1 ? 's' : ''}</span>
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            Aucun palier souscrit. Choisissez-en un ci-dessous.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {(packs.data ?? []).map((p) => {
            const current = p.code === st?.packCode;
            const included = p.modules.filter((c) => c !== 'core');
            return (
              <div key={p.code} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${current ? 'var(--accent)' : 'var(--border)'}`,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {p.label}
                    {current && <span className="badge success" style={{ marginLeft: 8 }}>votre formule</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    Socle inclus{included.length ? ' + ' : ''}
                    {included.map((c) => moduleLabels.get(c) ?? c).join(' + ')}
                  </div>
                </div>
                <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{euro(p.priceMonthly)}<span className="muted" style={{ fontWeight: 400, fontSize: 11 }}> /siège</span></div>
                <button
                  className={current ? 'btn btn-secondary' : 'btn'}
                  disabled={changePack.isPending}
                  onClick={() => changePack.mutate({ packCode: p.code, seats: Math.max(1, Number(seats) || 1) })}
                >
                  {current ? 'Ajuster' : p.tierLevel > currentTier ? 'Passer à ce palier' : 'Redescendre'}
                </button>
              </div>
            );
          })}
        </div>

        <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
          <label>Nombre de jetons du palier</label>
          <input
            type="number" min={1} value={seats}
            aria-label="Jetons du palier"
            onChange={(e) => setSeatDraft(e.target.value)}
            style={{ width: 90, textAlign: 'right' }}
          />
        </div>
      </div>

      {/* Options à la carte */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Options</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Les options se souscrivent par-dessus votre formule. Certaines nécessitent un palier minimum.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(addons.data ?? []).map((a) => {
            const requiredPack = (packs.data ?? []).find((p) => p.tierLevel === a.minTierLevel);
            const draft = addonDraft[a.code] ?? String(a.seats || 1);
            const onDevis = a.priceMonthly === null;
            return (
              <div key={a.code} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${a.seats > 0 ? 'var(--accent)' : 'var(--border)'}`,
                opacity: a.eligible ? 1 : 0.55,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {a.label}
                    {a.seats > 0 && <span className="badge success" style={{ marginLeft: 8 }}>souscrite</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {a.eligible
                      ? onDevis ? 'Sur devis' : `${euro(a.priceMonthly)} /siège/mois`
                      : `Nécessite au minimum le palier ${requiredPack?.label ?? a.minTierLevel}`}
                  </div>
                </div>
                {a.eligible && !onDevis && (
                  <>
                    <input
                      type="number" min={0} value={draft}
                      aria-label={`Jetons ${a.label}`}
                      onChange={(e) => setAddonDraft({ ...addonDraft, [a.code]: e.target.value })}
                      style={{ width: 56, textAlign: 'right' }}
                    />
                    <button
                      className="btn btn-secondary"
                      disabled={changeAddon.isPending}
                      onClick={() => changeAddon.mutate({ moduleCode: a.code, seats: Math.max(0, Number(draft) || 0) })}
                    >
                      {a.seats > 0 ? 'Ajuster' : 'Souscrire'}
                    </button>
                    {a.seats > 0 && (
                      <button
                        className="btn-ghost"
                        title="Retirer l’option"
                        disabled={changeAddon.isPending}
                        onClick={() => changeAddon.mutate({ moduleCode: a.code, seats: 0 })}
                      >
                        Retirer
                      </button>
                    )}
                  </>
                )}
                {a.eligible && onDevis && <span className="muted" style={{ fontSize: 11 }}>Nous contacter</span>}
              </div>
            );
          })}
        </div>
      </div>

      <SeatAssignments />
    </div>
  );
}

/* ─────────── Affectation des jetons ─────────── */
function SeatAssignments() {
  const api = useApi();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});

  const modules = useQuery({
    queryKey: ['subscription-modules'],
    queryFn: () => api<SubscribedModule[]>('/subscription/modules'),
  });
  const users = useQuery({
    queryKey: ['tenant-users'],
    queryFn: () => api<TenantUser[]>('/users'),
  });
  const seats = useQuery({
    queryKey: ['seats'],
    queryFn: () => api<SeatAssignment[]>('/seats'),
  });

  const assign = useMutation({
    mutationFn: (v: { moduleCode: string; userId: string }) =>
      api('/seats', { method: 'POST', body: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seats'] });
      qc.invalidateQueries({ queryKey: ['subscription-modules'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });
  const unassign = useMutation({
    mutationFn: (id: string) => api(`/seats/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seats'] });
      qc.invalidateQueries({ queryKey: ['subscription-modules'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });

  const activeModules = (modules.data ?? []).filter((m) => m.active);
  const seatsByModule = useMemo(() => {
    const map = new Map<string, SeatAssignment[]>();
    for (const a of seats.data ?? []) {
      const list = map.get(a.moduleCode) ?? [];
      list.push(a);
      map.set(a.moduleCode, list);
    }
    return map;
  }, [seats.data]);

  const userName = (u: TenantUser) => u.fullName || u.email;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Affectation des jetons</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Un utilisateur accède à un module uniquement si un jeton de ce module lui est affecté.
        Les jetons affectés ne peuvent dépasser les jetons achetés.
      </p>
      {err && <div className="error">{err}</div>}

      {activeModules.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>Aucun module actif. Souscrivez un module ci-dessus.</p>
      )}

      {activeModules.map((m) => {
        const assigned = seatsByModule.get(m.moduleCode) ?? [];
        const assignedUserIds = new Set(assigned.map((a) => a.userId));
        const available = (users.data ?? []).filter((u) => !assignedUserIds.has(u.id));
        const full = m.seatsAssigned >= m.seatsPurchased;
        return (
          <div key={m.moduleCode} style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <strong>{m.moduleCode}</strong>
              <span className="badge info">{m.seatsAssigned}/{m.seatsPurchased} jetons</span>
            </div>

            {assigned.length > 0 ? (
              <table className="grid" style={{ marginBottom: 8 }}>
                <tbody>
                  {assigned.map((a) => (
                    <tr key={a.id}>
                      <td>{a.fullName || '—'}</td>
                      <td className="muted">{a.email}</td>
                      <td style={{ textAlign: 'right', width: 40 }}>
                        <button className="btn-ghost" title="Retirer le jeton" onClick={() => { setErr(null); unassign.mutate(a.id); }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted" style={{ margin: '0 0 8px' }}>Aucun jeton affecté.</p>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {full ? (
                <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Lock size={12} /> Tous les jetons sont affectés. Ajustez le nombre de jetons pour en affecter plus.
                </span>
              ) : (
                <>
                  <select
                    value={pick[m.moduleCode] ?? ''}
                    onChange={(e) => setPick({ ...pick, [m.moduleCode]: e.target.value })}
                    style={{ minWidth: 220 }}
                  >
                    <option value="">— Choisir un utilisateur —</option>
                    {available.map((u) => (
                      <option key={u.id} value={u.id}>{userName(u)} ({u.email})</option>
                    ))}
                  </select>
                  <button
                    className="btn"
                    disabled={assign.isPending || !pick[m.moduleCode]}
                    onClick={() => {
                      setErr(null);
                      const userId = pick[m.moduleCode];
                      if (!userId) return;
                      assign.mutate({ moduleCode: m.moduleCode, userId });
                      setPick({ ...pick, [m.moduleCode]: '' });
                    }}
                  >
                    <Plus size={14} /> Affecter
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
