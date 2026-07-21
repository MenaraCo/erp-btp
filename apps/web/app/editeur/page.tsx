'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, LogOut, ShieldAlert, Settings2, X } from 'lucide-react';
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
  moduleDetails: { code: string; seats: number; active: boolean }[];
  seatsPurchased: number;
  seatsAssigned: number;
  mrr: number;
}
interface CatalogModule {
  code: string;
  label: string;
  priceMonthly: number | null;
  isAddon: boolean;
  active: boolean;
  description?: string | null;
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
  const [managing, setManaging] = useState<TenantRow | null>(null);
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
                          <ActionBtn title="Gérer l’abonnement" accent onClick={() => setManaging(t)}>
                            <Settings2 size={13} /> Gérer
                          </ActionBtn>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <CatalogEditor token={token} onChanged={refresh} />

            <p style={{ color: '#64748b', fontSize: 11, marginTop: 12 }}>
              Prochainement : codes promo.
            </p>
          </>
        ) : (
          <p style={{ color: '#94a3b8' }}>Impossible de charger les données.</p>
        )}
      </div>

      {managing && (
        <TenantManager
          token={token}
          tenant={managing}
          onClose={() => setManaging(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

/* ─────────── édition du catalogue commercial ─────────── */
function CatalogEditor({ token, onChanged }: { token: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ['editor-catalog'],
    queryFn: () => apiFetch<CatalogModule[]>('/editor/catalog', { token }),
    retry: false,
  });

  async function savePrice(code: string, raw: string) {
    setErr(null);
    setSavingCode(code);
    try {
      // champ vide = « sur devis » (null)
      const trimmed = raw.trim().replace(',', '.');
      const priceMonthly = trimmed === '' ? null : Number(trimmed);
      if (priceMonthly !== null && (!Number.isFinite(priceMonthly) || priceMonthly < 0)) {
        throw new ApiError(400, 'Prix invalide');
      }
      await apiFetch(`/editor/catalog/modules/${code}`, {
        method: 'POST', body: { priceMonthly }, token,
      });
      await qc.invalidateQueries({ queryKey: ['editor-catalog'] });
      await qc.invalidateQueries({ queryKey: ['public-catalog-modules'] });
      onChanged(); // MRR / abonnés dépendent des prix
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible');
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, marginTop: 20 }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #334155' }}>
        <div style={{ color: '#fff', fontWeight: 600 }}>Catalogue & prix</div>
        <div style={{ color: '#64748b', fontSize: 11 }}>
          Prix €HT par siège et par mois. Champ vide = « sur devis ». Effet immédiat sur les devis,
          la page d’inscription et le MRR — sans redéploiement.
        </div>
      </div>
      {err && <div className="error" style={{ margin: 12 }}>{err}</div>}
      {catalog.isLoading && <p style={{ color: '#94a3b8', padding: 16 }}>Chargement…</p>}
      {catalog.data && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Module</Th>
              <Th>Code</Th>
              <Th right>Prix /siège/mois</Th>
              <Th right>Actif</Th>
            </tr>
          </thead>
          <tbody>
            {catalog.data.map((m) => (
              <CatalogRow
                key={m.code}
                module={m}
                saving={savingCode === m.code}
                onSavePrice={(v) => savePrice(m.code, v)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CatalogRow({
  module: m, saving, onSavePrice,
}: {
  module: CatalogModule; saving: boolean; onSavePrice: (raw: string) => void;
}) {
  const initial = m.priceMonthly === null ? '' : String(m.priceMonthly);
  const [val, setVal] = useState(initial);
  const dirty = val.trim().replace(',', '.') !== initial;

  return (
    <tr style={{ borderTop: '1px solid #334155' }}>
      <Td>
        <span style={{ color: '#fff' }}>{m.label}</span>
        {m.isAddon && <span className="badge info" style={{ marginLeft: 6 }}>add-on</span>}
      </Td>
      <Td><span style={{ color: '#64748b', fontSize: 11 }}>{m.code}</span></Td>
      <Td right>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && dirty) onSavePrice(val); }}
            placeholder="sur devis"
            aria-label={`Prix ${m.label}`}
            style={{ ...darkInput, width: 90, textAlign: 'right', padding: '5px 8px' }}
          />
          <ActionBtn
            accent={dirty}
            title="Enregistrer le prix"
            disabled={saving || !dirty}
            onClick={() => onSavePrice(val)}
          >
            {saving ? '…' : 'Enregistrer'}
          </ActionBtn>
        </div>
      </Td>
      <Td right>
        <span className={`badge ${m.active ? 'success' : 'warning'}`}>{m.active ? 'oui' : 'non'}</span>
      </Td>
    </tr>
  );
}

/* ─────────── panneau de gestion d'un abonné ─────────── */
function TenantManager({
  token, tenant, onClose, onChanged,
}: {
  token: string; tenant: TenantRow; onClose: () => void; onChanged: () => void;
}) {
  const [t, setT] = useState<TenantRow>(tenant);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trialDays, setTrialDays] = useState('30');
  const [periodDate, setPeriodDate] = useState(t.currentPeriodEnd ? t.currentPeriodEnd.slice(0, 10) : '');
  const [newModule, setNewModule] = useState('');
  const [newSeats, setNewSeats] = useState('1');

  const catalogModules = useQuery({
    queryKey: ['public-catalog-modules'],
    queryFn: () => apiFetch<CatalogModule[]>('/public/catalog/modules'),
  });

  const labelByCode = new Map((catalogModules.data ?? []).map((m) => [m.code, m.label]));

  async function run(path: string, body?: unknown) {
    setErr(null);
    setBusy(true);
    try {
      const updated = await apiFetch<TenantRow>(`/editor/tenants/${t.tenantId}/${path}`, {
        method: 'POST', body, token,
      });
      setT(updated);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Action impossible');
    } finally {
      setBusy(false);
    }
  }

  const notSubscribed = (catalogModules.data ?? []).filter(
    (m) => !t.moduleDetails.some((d) => d.code === m.code),
  );

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '40px 16px', zIndex: 50, overflowY: 'auto' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 14, color: '#e2e8f0' }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #334155' }}>
          <div>
            <div style={{ color: '#fff', fontWeight: 600 }}>{t.name}</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>
              {t.slug} · <span className={`badge ${STATUS_BADGE[t.status ?? ''] ?? 'info'}`}>{STATUS_LABELS[t.status ?? ''] ?? t.status ?? '—'}</span>
              {t.cancelAtPeriodEnd && <span className="badge warning" style={{ marginLeft: 6 }}>résil.</span>}
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ color: '#94a3b8' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {err && <div className="error">{err}</div>}

          {/* Statut */}
          <Section title="Statut">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <ActionBtn accent title="Forcer l’abonnement actif" disabled={busy} onClick={() => run('status', { status: 'active' })}>Activer</ActionBtn>
              <ActionBtn title="Suspendre (accès fermé, données conservées)" disabled={busy} onClick={() => run('status', { status: 'paused' })}>Suspendre</ActionBtn>
              <ActionBtn title="Marquer comme impayé" disabled={busy} onClick={() => run('status', { status: 'past_due' })}>Impayé</ActionBtn>
              <ActionBtn title="Résilier immédiatement (accès fermé)" disabled={busy} onClick={() => run('status', { status: 'canceled' })}>Résilier maintenant</ActionBtn>
            </div>
          </Section>

          {/* Essai */}
          <Section title="Essai">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="number" min={1} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} style={{ ...darkInput, width: 70 }} />
              <span style={{ color: '#94a3b8', fontSize: 12 }}>jours</span>
              <ActionBtn title="Repasser en essai pour N jours" disabled={busy} onClick={() => run('status', { status: 'trialing', trialDays: Number(trialDays) })}>Repasser en essai</ActionBtn>
              <ActionBtn title="Prolonger l’essai en cours de N jours" disabled={busy} onClick={() => run('extend-trial', { days: Number(trialDays) })}>Prolonger (+{trialDays} j)</ActionBtn>
            </div>
          </Section>

          {/* Résiliation fin de période */}
          <Section title="Résiliation en fin de période">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <ActionBtn title="Programmer la résiliation" disabled={busy || t.cancelAtPeriodEnd} onClick={() => run('cancel', { cancel: true })}>Programmer</ActionBtn>
              <ActionBtn title="Annuler la résiliation programmée" disabled={busy || !t.cancelAtPeriodEnd} onClick={() => run('cancel', { cancel: false })}>Annuler la résiliation</ActionBtn>
            </div>
          </Section>

          {/* Échéance */}
          <Section title="Échéance (fin de période)">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={periodDate} onChange={(e) => setPeriodDate(e.target.value)} style={{ ...darkInput, width: 160 }} />
              <ActionBtn title="Définir la date d’échéance" disabled={busy || !periodDate} onClick={() => run('period-end', { date: periodDate })}>Définir</ActionBtn>
            </div>
          </Section>

          {/* Modules & jetons */}
          <Section title="Modules & jetons">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {t.moduleDetails.map((m) => (
                <ModuleRow
                  key={m.code}
                  label={labelByCode.get(m.code) ?? m.code}
                  code={m.code}
                  seats={m.seats}
                  active={m.active}
                  busy={busy}
                  onApply={(seats) => run('module', { moduleCode: m.code, seats })}
                />
              ))}
            </div>
            {notSubscribed.length > 0 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
                <select value={newModule} onChange={(e) => setNewModule(e.target.value)} style={{ ...darkInput, width: 200 }}>
                  <option value="">— Ajouter un module —</option>
                  {notSubscribed.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
                </select>
                <input type="number" min={1} value={newSeats} onChange={(e) => setNewSeats(e.target.value)} style={{ ...darkInput, width: 64 }} />
                <ActionBtn accent title="Ajouter le module" disabled={busy || !newModule} onClick={() => { run('module', { moduleCode: newModule, seats: Number(newSeats) }); setNewModule(''); }}>Ajouter</ActionBtn>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function ModuleRow({
  label, code, seats, active, busy, onApply,
}: {
  label: string; code: string; seats: number; active: boolean; busy: boolean; onApply: (seats: number) => void;
}) {
  const [val, setVal] = useState(String(seats));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #334155', borderRadius: 8, opacity: active ? 1 : 0.55 }}>
      <div style={{ flex: 1 }}>
        <span style={{ color: '#fff', fontSize: 13 }}>{label}</span>
        {!active && <span className="badge warning" style={{ marginLeft: 6 }}>désactivé</span>}
      </div>
      <input type="number" min={0} value={val} onChange={(e) => setVal(e.target.value)} style={{ ...darkInput, width: 60 }} />
      <ActionBtn title="Appliquer le nombre de jetons" disabled={busy} onClick={() => onApply(Number(val))}>Appliquer</ActionBtn>
      {active && code !== 'core' && (
        <ActionBtn title="Désactiver le module" disabled={busy} onClick={() => onApply(0)}>Désactiver</ActionBtn>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>{title}</div>
      {children}
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
