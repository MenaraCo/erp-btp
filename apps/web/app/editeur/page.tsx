'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, LogOut, ShieldAlert, CalendarPlus, Zap } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';

/* ─────────── types ─────────── */
interface Overview {
  tenants: number;
  trialing: number;
  active: number;
  pastDue: number;
  canceled: number;
  paused: number;
  mrr: number;
  arr: number;
  trialsEndingSoon: number;
  conversionRate: number;
}
interface TenantRow {
  tenantId: string;
  slug: string;
  name: string;
  createdAt: string;
  status: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  activeModules: string[];
  seatsPurchased: number;
  seatsAssigned: number;
  mrr: number;
}

const STATUS_LABELS: Record<string, string> = {
  trialing: 'Essai',
  active: 'Actif',
  past_due: 'Impayé',
  paused: 'En pause',
  canceled: 'Résilié',
};
const STATUS_BADGE: Record<string, string> = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  paused: 'warning',
  canceled: 'danger',
};

/* ═══════════════════════════════════════════════════════════ */
export default function EditeurPage() {
  const { token, isAuthenticated, logout } = useAuth();

  if (!isAuthenticated || !token) return <EditorLogin />;
  return <EditorConsole token={token} onLogout={logout} />;
}

/* ─────────── login (console éditeur) ─────────── */
function EditorLogin() {
  const { login } = useAuth();
  const [tenant, setTenant] = useState('demo');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(tenant, email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion impossible');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
      <form
        onSubmit={onSubmit}
        style={{ width: 340, background: '#1e293b', border: '1px solid #334155', borderRadius: 14, padding: 26, color: '#e2e8f0' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <ShieldAlert size={18} color="#f97316" />
          <h1 style={{ margin: 0, fontSize: 18, color: '#fff' }}>Console éditeur</h1>
        </div>
        <p style={{ marginTop: 0, color: '#94a3b8', fontSize: 12 }}>Back-office de la plateforme — réservé à l’éditeur.</p>
        {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
        <Field label="Entreprise (slug)"><input value={tenant} onChange={(e) => setTenant(e.target.value)} style={darkInput} /></Field>
        <Field label="E-mail"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={darkInput} /></Field>
        <Field label="Mot de passe"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={darkInput} /></Field>
        <button className="btn" type="submit" disabled={loading} style={{ width: '100%', marginTop: 6 }}>
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}

/* ─────────── console ─────────── */
function EditorConsole({ token, onLogout }: { token: string; onLogout: () => void }) {
  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: ['editor-overview'],
    queryFn: () => apiFetch<Overview>('/editor/overview', { token }),
    retry: false,
  });
  const tenants = useQuery({
    queryKey: ['editor-tenants'],
    queryFn: () => apiFetch<TenantRow[]>('/editor/tenants', { token }),
    retry: false,
    enabled: !overview.isError,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['editor-tenants'] });
    qc.invalidateQueries({ queryKey: ['editor-overview'] });
  };
  const extendTrial = useMutation({
    mutationFn: (tenantId: string) =>
      apiFetch(`/editor/tenants/${tenantId}/extend-trial`, { method: 'POST', body: { days: 30 }, token }),
    onSuccess: refresh,
  });
  const activate = useMutation({
    mutationFn: (tenantId: string) =>
      apiFetch(`/editor/tenants/${tenantId}/activate`, { method: 'POST', token }),
    onSuccess: refresh,
  });
  const pendingId =
    (extendTrial.isPending && extendTrial.variables) ||
    (activate.isPending && activate.variables) ||
    null;

  const forbidden =
    (overview.error instanceof ApiError && overview.error.status === 403);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LayoutDashboard size={18} color="#f97316" />
          <strong style={{ color: '#fff' }}>ERP BTP — Console éditeur</strong>
        </div>
        <button onClick={onLogout} className="btn-ghost" style={{ color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <LogOut size={14} /> Quitter
        </button>
      </div>

      <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
        {forbidden ? (
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 32, textAlign: 'center' }}>
            <ShieldAlert size={28} color="#f59e0b" />
            <h2 style={{ color: '#fff' }}>Accès réservé à l’éditeur</h2>
            <p style={{ color: '#94a3b8' }}>Ce compte n’est pas autorisé à accéder au back-office de la plateforme.</p>
            <button onClick={onLogout} className="btn btn-secondary">Changer de compte</button>
          </div>
        ) : overview.isLoading ? (
          <p style={{ color: '#94a3b8' }}>Chargement…</p>
        ) : overview.data ? (
          <>
            {/* KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
              <Kpi label="MRR" value={euro(overview.data.mrr)} accent />
              <Kpi label="ARR" value={euro(overview.data.arr)} />
              <Kpi label="Abonnés" value={String(overview.data.tenants)} />
              <Kpi label="Actifs" value={String(overview.data.active)} />
              <Kpi label="Essais" value={String(overview.data.trialing)} />
              <Kpi label="Conversion" value={`${Math.round(overview.data.conversionRate * 100)} %`} />
              <Kpi label="Impayés" value={String(overview.data.pastDue)} danger={overview.data.pastDue > 0} />
              <Kpi label="Essais < 7 j" value={String(overview.data.trialsEndingSoon)} danger={overview.data.trialsEndingSoon > 0} />
            </div>

            {/* tenants table */}
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #334155', fontWeight: 600, color: '#fff' }}>
                Abonnés {tenants.data ? `(${tenants.data.length})` : ''}
              </div>
              {tenants.isLoading ? (
                <p style={{ padding: 16, color: '#94a3b8' }}>Chargement…</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                      <Th>Entreprise</Th>
                      <Th>Statut</Th>
                      <Th>Modules</Th>
                      <Th>Jetons</Th>
                      <Th right>Échéance</Th>
                      <Th right>MRR</Th>
                      <Th right>Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tenants.data ?? []).map((t) => (
                      <tr key={t.tenantId} style={{ borderTop: '1px solid #334155' }}>
                        <Td>
                          <div style={{ color: '#fff', fontWeight: 500 }}>{t.name}</div>
                          <div style={{ color: '#64748b', fontSize: 11 }}>{t.slug}</div>
                        </Td>
                        <Td>
                          {t.status ? (
                            <span className={`badge ${STATUS_BADGE[t.status] ?? 'info'}`}>{STATUS_LABELS[t.status] ?? t.status}</span>
                          ) : <span style={{ color: '#64748b' }}>—</span>}
                          {t.cancelAtPeriodEnd && <span className="badge warning" style={{ marginLeft: 6 }}>résil.</span>}
                        </Td>
                        <Td>{t.activeModules.length}</Td>
                        <Td>{t.seatsAssigned}/{t.seatsPurchased}</Td>
                        <Td right>
                          {t.status === 'trialing' && t.trialEndsAt
                            ? `essai ${new Date(t.trialEndsAt).toLocaleDateString('fr-FR')}`
                            : t.currentPeriodEnd
                              ? new Date(t.currentPeriodEnd).toLocaleDateString('fr-FR')
                              : '—'}
                        </Td>
                        <Td right><span style={{ color: t.mrr > 0 ? '#4ade80' : '#64748b', fontVariantNumeric: 'tabular-nums' }}>{euro(t.mrr)}</span></Td>
                        <Td right>
                          <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                            {t.status === 'trialing' && (
                              <ActionBtn
                                title="Prolonger l’essai de 30 jours"
                                disabled={pendingId === t.tenantId}
                                onClick={() => extendTrial.mutate(t.tenantId)}
                              >
                                <CalendarPlus size={13} /> +30 j
                              </ActionBtn>
                            )}
                            {t.status !== 'active' && (
                              <ActionBtn
                                title="Activer (paiement hors-ligne / geste commercial)"
                                accent
                                disabled={pendingId === t.tenantId}
                                onClick={() => activate.mutate(t.tenantId)}
                              >
                                <Zap size={13} /> Activer
                              </ActionBtn>
                            )}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p style={{ color: '#64748b', fontSize: 11, marginTop: 12 }}>
              Prochainement : édition du catalogue et des prix, codes promo, actions support (prolonger un essai, ajuster une souscription).
            </p>
          </>
        ) : (
          <p style={{ color: '#94a3b8' }}>Impossible de charger les données.</p>
        )}
      </div>
    </div>
  );
}

/* ─────────── petits helpers UI ─────────── */
const darkInput: React.CSSProperties = {
  width: '100%', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '8px 10px',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
function Kpi({ label, value, accent, danger }: { label: string; value: string; accent?: boolean; danger?: boolean }) {
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: danger ? '#f87171' : accent ? '#fb923c' : '#fff' }}>{value}</div>
    </div>
  );
}
function ActionBtn({
  children, onClick, title, accent, disabled,
}: {
  children: React.ReactNode; onClick: () => void; title: string; accent?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, whiteSpace: 'nowrap',
        padding: '4px 8px', borderRadius: 6, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        border: `1px solid ${accent ? '#f97316' : '#475569'}`,
        background: accent ? '#f97316' : 'transparent',
        color: accent ? '#fff' : '#cbd5e1',
      }}
    >
      {children}
    </button>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th style={{ padding: '8px 16px', fontWeight: 500, textAlign: right ? 'right' : 'left' }}>{children}</th>;
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td style={{ padding: '10px 16px', textAlign: right ? 'right' : 'left' }}>{children}</td>;
}
