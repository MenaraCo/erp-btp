'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, LogOut, ShieldAlert, Settings2, X, Building2, Trash2 } from 'lucide-react';
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
  /** MRR après remise promo (facturé). */
  mrr: number;
  /** MRR avant remise. */
  mrrGross: number;
  promoCode: { code: string; discountType: 'percent' | 'fixed'; discountValue: number } | null;
}
interface CatalogModule {
  code: string;
  label: string;
  priceMonthly: number | null;
  isAddon: boolean;
  active: boolean;
  description?: string | null;
}
interface PackRow {
  code: string;
  label: string;
  tierLevel: number;
  priceMonthly: number | null;
  /** Jetons ouverts par siège (défaut renvoyé par l'API = nombre de modules du palier). */
  seatTokens: number;
  modules: string[];
}
interface PromoCodeRow {
  id: string;
  code: string;
  label: string | null;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  appliesTo: 'monthly' | 'annual' | 'both';
  durationMonths: number | null;
  active: boolean;
  validFrom: string | null;
  validUntil: string | null;
  maxRedemptions: number | null;
  redemptions: number;
  usable: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  incomplete: 'Paiement attendu',
  trialing: 'Essai',
  active: 'Actif',
  past_due: 'Impayé',
  paused: 'En pause',
  canceled: 'Résilié',
};
const STATUS_BADGE: Record<string, string> = {
  incomplete: 'warning',
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
  const [fiche, setFiche] = useState<TenantRow | null>(null);
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
                          <ActionBtn title="Fiche complète : administratif, contacts, volumes" onClick={() => setFiche(t)}>
                            <Building2 size={13} /> Fiche
                          </ActionBtn>
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
            <PackEditor token={token} onChanged={refresh} />
            <CatalogEditor token={token} onChanged={refresh} />
            <ReglagesCommerciaux token={token} onChanged={refresh} />
            <PromoCodesEditor token={token} onChanged={refresh} />
          </>
        ) : (
          <p style={{ color: '#94a3b8' }}>Impossible de charger les données.</p>
        )}
      </div>

      {fiche && (
        <FicheAbonne
          token={token}
          tenant={fiche}
          onClose={() => setFiche(null)}
          onSupprime={() => { setFiche(null); refresh(); }}
        />
      )}
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

/* ─────────── édition des paliers ─────────── */
function PackEditor({ token, onChanged }: { token: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const packs = useQuery({
    queryKey: ['editor-packs'],
    queryFn: () => apiFetch<PackRow[]>('/editor/packs', { token }),
    retry: false,
  });
  const catalog = useQuery({
    queryKey: ['editor-catalog'],
    queryFn: () => apiFetch<CatalogModule[]>('/editor/catalog', { token }),
    retry: false,
  });
  const labels = new Map((catalog.data ?? []).map((m) => [m.code, m.label]));

  async function savePack(code: string, patch: { priceMonthly?: number | null; seatTokens?: number | null }) {
    setErr(null);
    setSaving(code);
    try {
      await apiFetch(`/editor/packs/${code}`, { method: 'POST', body: patch, token });
      await qc.invalidateQueries({ queryKey: ['editor-packs'] });
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible');
    } finally {
      setSaving(null);
    }
  }

  function savePrice(code: string, raw: string) {
    const t = raw.trim().replace(',', '.');
    const priceMonthly = t === '' ? null : Number(t);
    if (priceMonthly !== null && (!Number.isFinite(priceMonthly) || priceMonthly < 0)) {
      setErr('Prix invalide');
      return;
    }
    void savePack(code, { priceMonthly });
  }

  function saveTokens(code: string, raw: string) {
    const t = raw.trim();
    const seatTokens = t === '' ? null : Math.trunc(Number(t));
    if (seatTokens !== null && (!Number.isFinite(seatTokens) || seatTokens < 1)) {
      setErr('Le nombre de jetons par siège doit être un entier ≥ 1 (ou vide pour le défaut)');
      return;
    }
    void savePack(code, { seatTokens });
  }

  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, marginTop: 20 }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #334155' }}>
        <div style={{ color: '#fff', fontWeight: 600 }}>Paliers & prix</div>
        <div style={{ color: '#64748b', fontSize: 11 }}>
          Prix €HT par siège et par mois, et nombre de jetons qu’ouvre un siège. Un client répartit
          ensuite ces jetons librement entre ses collaborateurs et ses modules. Effet immédiat sur
          l’inscription, les abonnements et le MRR — sans redéploiement.
        </div>
      </div>
      {err && <div className="error" style={{ margin: 12 }}>{err}</div>}
      {packs.isLoading && <p style={{ color: '#94a3b8', padding: 16 }}>Chargement…</p>}
      {packs.data && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Palier</Th>
              <Th>Contenu</Th>
              <Th right>Jetons /siège</Th>
              <Th right>Prix /siège/mois</Th>
            </tr>
          </thead>
          <tbody>
            {packs.data.map((p) => (
              <PackRowEditor
                key={p.code}
                pack={p}
                labels={labels}
                saving={saving === p.code}
                onSave={(v) => savePrice(p.code, v)}
                onSaveTokens={(v) => saveTokens(p.code, v)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PackRowEditor({
  pack, labels, saving, onSave, onSaveTokens,
}: {
  pack: PackRow;
  labels: Map<string, string>;
  saving: boolean;
  onSave: (raw: string) => void;
  onSaveTokens: (raw: string) => void;
}) {
  const initial = pack.priceMonthly === null ? '' : String(pack.priceMonthly);
  const [val, setVal] = useState(initial);
  const dirty = val.trim().replace(',', '.') !== initial;
  const included = pack.modules.filter((c) => c !== 'core');
  // Le défaut (un jeton par module) est ce que l'API renvoie déjà : on l'affiche tel quel.
  const tokensInitial = String(pack.seatTokens);
  const [tokens, setTokens] = useState(tokensInitial);
  const tokensDirty = tokens.trim() !== tokensInitial;

  return (
    <tr style={{ borderTop: '1px solid #334155' }}>
      <Td>
        <span style={{ color: '#fff', fontWeight: 600 }}>{pack.label}</span>
        <span style={{ color: '#64748b', fontSize: 11 }}> · palier {pack.tierLevel}</span>
      </Td>
      <Td>
        <span style={{ color: '#94a3b8', fontSize: 11 }}>
          Socle{included.length ? ' + ' : ''}
          {included.map((c) => labels.get(c) ?? c).join(' + ')}
        </span>
      </Td>
      <Td right>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input
            value={tokens}
            onChange={(e) => setTokens(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && tokensDirty) onSaveTokens(tokens); }}
            aria-label={`Jetons par siège ${pack.label}`}
            title="Nombre de jetons qu’ouvre un siège. Par défaut : un jeton par module du palier."
            style={{ ...darkInput, width: 60, textAlign: 'right', padding: '5px 8px' }}
          />
          <ActionBtn accent={tokensDirty} title="Enregistrer les jetons par siège"
            disabled={saving || !tokensDirty} onClick={() => onSaveTokens(tokens)}>
            {saving ? '…' : 'OK'}
          </ActionBtn>
        </div>
      </Td>
      <Td right>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && dirty) onSave(val); }}
            aria-label={`Prix ${pack.label}`}
            style={{ ...darkInput, width: 90, textAlign: 'right', padding: '5px 8px' }}
          />
          <ActionBtn accent={dirty} title="Enregistrer le prix" disabled={saving || !dirty} onClick={() => onSave(val)}>
            {saving ? '…' : 'Enregistrer'}
          </ActionBtn>
        </div>
      </Td>
    </tr>
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
        <div style={{ color: '#fff', fontWeight: 600 }}>Modules & options</div>
        <div style={{ color: '#64748b', fontSize: 11 }}>
          Prix des options à la carte (les modules inclus dans un palier sont facturés via le
          palier). Champ vide = « sur devis ».
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

/* ─────────── réglages commerciaux (essai, remise d'engagement) ─────────── */
function ReglagesCommerciaux({ token, onChanged }: { token: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // `null` = champ jamais touché (on montre la valeur du serveur). Une CHAÎNE VIDE est une saisie
  // à part entière : sans cette distinction, vider la cellule la faisait aussitôt se re-remplir,
  // et il devenait impossible de taper un nouveau chiffre.
  const [jours, setJours] = useState<string | null>(null);
  const [remise, setRemise] = useState<string | null>(null);

  const reglages = useQuery({
    queryKey: ['editor-pricing-settings'],
    queryFn: () => apiFetch<{ annualDiscountPct: number; trialDays: number }>(
      '/editor/pricing-settings', { token },
    ),
    retry: false,
  });

  // Valeurs servies par l'API tant que l'éditeur n'a rien tapé.
  const joursServeur = String(reglages.data?.trialDays ?? '');
  const remiseServeur = String(reglages.data?.annualDiscountPct ?? '');
  const joursAff = jours ?? joursServeur;
  const remiseAff = remise ?? remiseServeur;
  // On n'enregistre que si la valeur est renseignée ET différente de celle déjà en place.
  const joursModifie = jours !== null && jours.trim() !== '' && jours.trim() !== joursServeur;
  const remiseModifiee = remise !== null && remise.trim() !== '' && remise.trim() !== remiseServeur;

  async function enregistrer(chemin: string, body: Record<string, number>) {
    setErr(null);
    setBusy(true);
    try {
      await apiFetch(`/editor/${chemin}`, { method: 'POST', token, body });
      await qc.invalidateQueries({ queryKey: ['editor-pricing-settings'] });
      // Retour à « non touché » : le champ réaffiche ce que le serveur vient de confirmer.
      setJours(null); setRemise(null);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Enregistrement impossible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, marginTop: 20 }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #334155' }}>
        <div style={{ color: '#fff', fontWeight: 600 }}>Réglages commerciaux</div>
        <div style={{ color: '#64748b', fontSize: 11 }}>
          Durée de l’essai gratuit et remise d’engagement annuel. La durée s’applique aux
          inscriptions SUIVANTES : les essais déjà ouverts gardent leur échéance.
        </div>
      </div>
      {err && <div className="error" style={{ margin: 12 }}>{err}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', padding: 12 }}>
        <FieldSm label="Essai gratuit (jours)">
          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              value={joursAff}
              onChange={(e) => setJours(e.target.value)}
              aria-label="Durée de l’essai gratuit en jours"
              style={{ ...darkInput, width: 70, textAlign: 'right' }}
            />
            <ActionBtn accent={joursModifie} title="Enregistrer la durée d’essai"
              disabled={busy || !joursModifie}
              onClick={() => enregistrer('trial-settings', { trialDays: Number(jours) })}>
              {busy ? '…' : 'OK'}
            </ActionBtn>
          </div>
        </FieldSm>
        <FieldSm label="Remise engagement annuel (%)">
          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              value={remiseAff}
              onChange={(e) => setRemise(e.target.value)}
              aria-label="Remise d’engagement annuel en pourcentage"
              style={{ ...darkInput, width: 70, textAlign: 'right' }}
            />
            <ActionBtn accent={remiseModifiee} title="Enregistrer la remise"
              disabled={busy || !remiseModifiee}
              onClick={() => enregistrer('pricing-settings', { annualDiscountPct: Number(remise) })}>
              {busy ? '…' : 'OK'}
            </ActionBtn>
          </div>
        </FieldSm>
      </div>
    </div>
  );
}

/* ─────────── codes promo ─────────── */
function PromoCodesEditor({ token, onChanged }: { token: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState('10');
  const [appliesTo, setAppliesTo] = useState<'monthly' | 'annual' | 'both'>('both');
  // '' = toute la période ; sinon nombre de premiers mois remisés.
  const [durationMonths, setDurationMonths] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');

  const promos = useQuery({
    queryKey: ['editor-promo-codes'],
    queryFn: () => apiFetch<PromoCodeRow[]>('/editor/promo-codes', { token }),
    retry: false,
  });

  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['editor-promo-codes'] });
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Action impossible');
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run(async () => {
      await apiFetch('/editor/promo-codes', {
        method: 'POST',
        token,
        body: {
          code,
          label: label || null,
          discountType,
          discountValue: Number(discountValue.replace(',', '.')),
          appliesTo,
          durationMonths: durationMonths === '' ? null : Number(durationMonths),
          validUntil: validUntil || null,
          maxRedemptions: maxRedemptions === '' ? null : Number(maxRedemptions),
        },
      });
      setCode(''); setLabel(''); setValidUntil(''); setMaxRedemptions('');
      setAppliesTo('both'); setDurationMonths('');
    });

  const toggle = (p: PromoCodeRow) =>
    run(() => apiFetch(`/editor/promo-codes/${p.id}`, {
      method: 'POST', token, body: { active: !p.active },
    }));

  const remove = (p: PromoCodeRow) =>
    run(() => apiFetch(`/editor/promo-codes/${p.id}`, { method: 'DELETE', token }));

  const fmtDiscount = (p: PromoCodeRow) =>
    p.discountType === 'percent' ? `−${p.discountValue} %` : `−${euro(p.discountValue)}`;

  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, marginTop: 20 }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #334155' }}>
        <div style={{ color: '#fff', fontWeight: 600 }}>Codes promo</div>
        <div style={{ color: '#64748b', fontSize: 11 }}>
          Remise en pourcentage ou en montant fixe, appliquée au MRR de l’abonné.
          Un code s’applique depuis « Gérer » sur la ligne d’un abonné.
        </div>
      </div>
      {err && <div className="error" style={{ margin: 12 }}>{err}</div>}

      {/* création */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-end', padding: 12, borderBottom: '1px solid #334155' }}>
        <FieldSm label="Code">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BTP2026" style={{ ...darkInput, width: 120 }} />
        </FieldSm>
        <FieldSm label="Libellé">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Offre de lancement" style={{ ...darkInput, width: 170 }} />
        </FieldSm>
        <FieldSm label="Type">
          <select value={discountType} onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')} style={{ ...darkInput, width: 100 }}>
            <option value="percent">%</option>
            <option value="fixed">€ fixe</option>
          </select>
        </FieldSm>
        <FieldSm label="Remise">
          <input value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} style={{ ...darkInput, width: 70, textAlign: 'right' }} />
        </FieldSm>
        <FieldSm label="S’applique à">
          <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as 'monthly' | 'annual' | 'both')} style={{ ...darkInput, width: 130 }}>
            <option value="both">Mensuel + annuel</option>
            <option value="monthly">Mensuel seul</option>
            <option value="annual">Annuel seul</option>
          </select>
        </FieldSm>
        <FieldSm label="Durée de la remise">
          <select value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} style={{ ...darkInput, width: 150 }}>
            <option value="">Toute la période</option>
            {[1, 2, 3, 4, 5, 6, 9, 12].map((n) => (
              <option key={n} value={String(n)}>
                {n === 1 ? '1er mois seulement' : `${n} premiers mois`}
              </option>
            ))}
          </select>
        </FieldSm>
        <FieldSm label="Valide jusqu’au">
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} style={{ ...darkInput, width: 140 }} />
        </FieldSm>
        <FieldSm label="Quota">
          <input value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="illimité" style={{ ...darkInput, width: 80, textAlign: 'right' }} />
        </FieldSm>
        <ActionBtn accent title="Créer le code promo" disabled={busy || !code.trim()} onClick={create}>
          Créer
        </ActionBtn>
      </div>

      {promos.isLoading && <p style={{ color: '#94a3b8', padding: 16 }}>Chargement…</p>}
      {promos.data && promos.data.length === 0 && (
        <p style={{ color: '#94a3b8', padding: 16, margin: 0 }}>Aucun code promo.</p>
      )}
      {promos.data && promos.data.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Remise</Th>
              <Th>Portée</Th>
              <Th>Durée</Th>
              <Th>Validité</Th>
              <Th right>Utilisations</Th>
              <Th right>État</Th>
              <Th right>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {promos.data.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid #334155' }}>
                <Td>
                  <div style={{ color: '#fff', fontWeight: 600 }}>{p.code}</div>
                  {p.label && <div style={{ color: '#64748b', fontSize: 11 }}>{p.label}</div>}
                </Td>
                <Td><span style={{ color: '#fff' }}>{fmtDiscount(p)}</span></Td>
                <Td>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>
                    {p.appliesTo === 'monthly' ? 'Mensuel' : p.appliesTo === 'annual' ? 'Annuel' : 'Mensuel + annuel'}
                  </span>
                </Td>
                <Td>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>
                    {p.durationMonths === null
                      ? 'Toute la période'
                      : p.durationMonths === 1
                        ? '1er mois'
                        : `${p.durationMonths} premiers mois`}
                  </span>
                </Td>
                <Td>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>
                    {p.validUntil ? `jusqu’au ${new Date(p.validUntil).toLocaleDateString('fr-FR')}` : 'sans limite'}
                  </span>
                </Td>
                <Td right>
                  {p.redemptions}{p.maxRedemptions !== null ? ` / ${p.maxRedemptions}` : ''}
                </Td>
                <Td right>
                  <span className={`badge ${p.usable ? 'success' : 'warning'}`}>
                    {p.usable ? 'utilisable' : p.active ? 'hors période/quota' : 'inactif'}
                  </span>
                </Td>
                <Td right>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <ActionBtn title={p.active ? 'Désactiver' : 'Activer'} disabled={busy} onClick={() => toggle(p)}>
                      {p.active ? 'Désactiver' : 'Activer'}
                    </ActionBtn>
                    <ActionBtn title="Supprimer le code" disabled={busy} onClick={() => remove(p)}>
                      Supprimer
                    </ActionBtn>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FieldSm({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label style={{ fontSize: 10, color: '#94a3b8' }}>{label}</label>
      {children}
    </div>
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
  const [promoInput, setPromoInput] = useState('');

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

          {/* Code promo */}
          <Section title="Code promo">
            {t.promoCode ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="badge success">{t.promoCode.code}</span>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>
                  {t.promoCode.discountType === 'percent'
                    ? `−${t.promoCode.discountValue} %`
                    : `−${euro(t.promoCode.discountValue)}`}
                  {' · '}MRR {euro(t.mrrGross)} → <strong style={{ color: '#4ade80' }}>{euro(t.mrr)}</strong>
                </span>
                <ActionBtn title="Retirer le code promo" disabled={busy} onClick={() => run('promo', { code: null })}>
                  Retirer
                </ActionBtn>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  style={{ ...darkInput, width: 140 }}
                />
                <ActionBtn
                  accent
                  title="Appliquer le code promo"
                  disabled={busy || !promoInput.trim()}
                  onClick={() => { run('promo', { code: promoInput.trim() }); setPromoInput(''); }}
                >
                  Appliquer
                </ActionBtn>
              </div>
            )}
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


interface FicheDetail {
  tenant: { id: string; slug: string; name: string; status: string; createdAt: string };
  societes: Array<Record<string, string | null>>;
  contacts: Array<{ email: string; full_name: string | null; status: string; mfa_enabled: boolean; roles: string[] }>;
  abonnement: Record<string, unknown> | null;
  volumes: Record<string, number>;
}

/**
 * Fiche complète d'un abonné : qui il est, qui le contacte, ce qu'il a produit.
 *
 * Le VOLUME est affiché avant la suppression, et ce n'est pas décoratif : supprimer un compte
 * d'essai vide et supprimer un client qui a deux ans de chantiers ne se décident pas de la même
 * façon. La suppression est définitive — 58 tables partent en cascade, il n'y a pas de corbeille.
 */
function FicheAbonne({
  token, tenant, onClose, onSupprime,
}: {
  token: string;
  tenant: TenantRow;
  onClose: () => void;
  onSupprime: () => void;
}) {
  const [confirmation, setConfirmation] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [suppression, setSuppression] = useState(false);

  const { data, isLoading } = useQuery<FicheDetail>({
    queryKey: ['editor-fiche', tenant.tenantId],
    queryFn: () => apiFetch<FicheDetail>(`/editor/tenants/${tenant.tenantId}`, { token }),
  });

  const supprimer = async () => {
    setErr(null);
    setSuppression(true);
    try {
      await apiFetch(`/editor/tenants/${tenant.tenantId}`, {
        method: 'DELETE', token,
        // `resilierDabord` n'est envoyé que si l'abonnement est actif ET que l'utilisateur a
        // confirmé le libellé explicite du bouton : le geste reste délibéré.
        body: { confirmationSlug: confirmation, resilierDabord: actif },
      });
      onSupprime();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Suppression impossible.');
    } finally {
      setSuppression(false);
    }
  };

  const c = data?.societes?.[0];
  const total = Object.values(data?.volumes ?? {}).reduce((a, b) => a + b, 0);
  const statutAbo = (data?.abonnement as { status?: string } | null)?.status ?? null;
  const actif = statutAbo === 'active';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', display: 'flex',
        justifyContent: 'center', alignItems: 'flex-start', padding: '40px 16px', zIndex: 50,
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720, maxWidth: '100%', background: '#1e293b', border: '1px solid #334155',
          borderRadius: 14, color: '#e2e8f0', padding: '20px 24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <strong style={{ fontSize: 16, color: '#fff' }}>{tenant.name}</strong>
            <div style={{ color: '#64748b', fontSize: 11 }}>{tenant.slug}</div>
          </div>
          <ActionBtn title="Fermer" onClick={onClose}><X size={14} /></ActionBtn>
        </div>

        {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

        {isLoading ? (
          <p style={{ color: '#94a3b8', fontSize: 12 }}>Chargement…</p>
        ) : (
          <>
            <SectionEditeur titre="Identité administrative">
              {c ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 12 }}>
                  <Ligne k="Dénomination" v={c.name} />
                  <Ligne k="Forme juridique" v={c.legal_form} />
                  <Ligne k="SIREN" v={c.siren} />
                  <Ligne k="SIRET" v={c.siret} />
                  <Ligne k="TVA intracom." v={c.vat_intra ?? c.vat_number} />
                  <Ligne k="RCS" v={c.rcs} />
                  <Ligne k="Capital" v={c.capital} />
                  <Ligne k="Adresse" v={[c.address, c.postal_code, c.city].filter(Boolean).join(' ')} />
                  <Ligne k="Téléphone" v={c.phone} />
                  <Ligne k="E-mail" v={c.email} />
                </div>
              ) : (
                <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>
                  Cette société n’a pas encore renseigné son identité (Configuration → Entreprise).
                </p>
              )}
            </SectionEditeur>

            <SectionEditeur titre={`Contacts (${data?.contacts.length ?? 0})`}>
              {(data?.contacts ?? []).map((u) => (
                <div key={u.email} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12, padding: '3px 0' }}>
                  <span style={{ color: '#fff', minWidth: 220 }}>{u.email}</span>
                  <span style={{ color: '#94a3b8', flex: 1 }}>{u.full_name ?? '—'}</span>
                  <span style={{ color: '#64748b', fontSize: 11 }}>{u.roles.join(', ') || 'aucun rôle'}</span>
                  {u.mfa_enabled && <span className="badge success">2FA</span>}
                </div>
              ))}
            </SectionEditeur>

            <SectionEditeur titre="Abonnement">
              <div style={{ fontSize: 12 }}>
                <span style={{ color: '#64748b' }}>Statut : </span>
                <span style={{ color: actif ? '#4ade80' : '#e2e8f0', fontWeight: 600 }}>
                  {statutAbo ?? '—'}
                </span>
              </div>
            </SectionEditeur>

            <SectionEditeur titre="Contenu produit">
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                {Object.entries(data?.volumes ?? {}).map(([k, v]) => (
                  <span key={k} style={{ color: v > 0 ? '#fff' : '#64748b' }}>
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</strong>{' '}
                    <span style={{ color: '#64748b' }}>{k}</span>
                  </span>
                ))}
              </div>
            </SectionEditeur>

            <SectionEditeur titre="Supprimer définitivement">
              <p style={{ color: '#fca5a5', fontSize: 12, margin: '0 0 10px', lineHeight: 1.5 }}>
                Cette société et <strong>tout son contenu</strong> ({total} enregistrements) seront
                effacés : affaires, devis, chantiers, factures, pointages. Il n’y a pas de corbeille
                et pas de retour en arrière.
              </p>
              {actif && (
                <p style={{ color: '#fbbf24', fontSize: 12, margin: '0 0 10px', lineHeight: 1.5 }}>
                  ⚠ Son abonnement est <strong>ACTIF</strong> : la suppression le résiliera d’abord.
                  Vous supprimez un client qui paie encore.
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  style={{ width: 240 }}
                  placeholder={`Retapez « ${tenant.slug} »`}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
                <button
                  className="btn-danger btn"
                  disabled={confirmation !== tenant.slug || suppression}
                  onClick={() => {
                    const question = actif
                      ? `« ${tenant.name} » a un abonnement ACTIF.\n\n`
                        + `Résilier cet abonnement ET supprimer définitivement la société avec tout `
                        + `son contenu (${total} enregistrements) ?`
                      : `Supprimer définitivement « ${tenant.name} » et tout son contenu ?`;
                    if (!confirm(question)) return;
                    void supprimer();
                  }}
                >
                  <Trash2 size={13} style={{ marginRight: 4 }} />
                  {suppression ? '…' : actif ? 'Résilier et supprimer' : 'Supprimer'}
                </button>
              </div>
            </SectionEditeur>
          </>
        )}
      </div>
    </div>
  );
}

function SectionEditeur({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: '#f97316', marginBottom: 8, paddingBottom: 5, borderBottom: '1px solid #334155',
      }}>{titre}</div>
      {children}
    </div>
  );
}

function Ligne({ k, v }: { k: string; v?: string | null }) {
  return (
    <div>
      <span style={{ color: '#64748b' }}>{k} : </span>
      <span style={{ color: v ? '#e2e8f0' : '#475569' }}>{v || '—'}</span>
    </div>
  );
}
