'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Gift, CreditCard, ArrowLeft, ShieldCheck } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { CompanySearch } from '@/components/CompanySearch';

/* ─────────── types ─────────── */
interface CatalogModule {
  code: string;
  label: string;
  isAddon: boolean;
  priceMonthly: number | null;
  description: string | null;
}
interface RegisterResult {
  accessToken: string;
  tenantSlug: string;
  email?: string;
}
type Door = 'trial' | 'direct';
type Step = 'door' | 'form' | 'payment';

/* ─────────── page ─────────── */
export default function InscriptionPage() {
  const router = useRouter();
  const { setSession } = useAuth();

  const [step, setStep] = useState<Step>('door');
  const [door, setDoor] = useState<Door>('trial');

  const [companyName, setCompanyName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [modules, setModules] = useState<CatalogModule[]>([]);
  // moduleCode -> seats (0 / undefined = not selected)
  const [seats, setSeats] = useState<Record<string, number>>({});

  // Formule : engagement (mensuel sans engagement / annuel 12 mois) et rythme de facturation.
  const [billingTerm, setBillingTerm] = useState<'monthly' | 'annual'>('monthly');
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [promoCode, setPromoCode] = useState('');
  const [annualDiscountPct, setAnnualDiscountPct] = useState(10);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Public catalogue for the "direct" door (prices, config-driven — no auth).
  useEffect(() => {
    apiFetch<CatalogModule[]>('/public/catalog/modules')
      .then(setModules)
      .catch(() => setModules([]));
    apiFetch<{ annualDiscountPct: number }>('/public/catalog/pricing')
      .then((p) => setAnnualDiscountPct(p.annualDiscountPct))
      .catch(() => undefined);
  }, []);

  const billableModules = useMemo(
    () => modules.filter((m) => m.code !== 'core' && m.priceMonthly !== null),
    [modules],
  );

  const selected = useMemo(
    () => billableModules.filter((m) => (seats[m.code] ?? 0) > 0),
    [billableModules, seats],
  );

  const monthlyTotal = useMemo(
    () =>
      selected.reduce((sum, m) => sum + (m.priceMonthly ?? 0) * (seats[m.code] ?? 0), 0),
    [selected, seats],
  );

  /** Mensuel après remise d'engagement (le code promo est validé/appliqué côté serveur). */
  const monthlyAfterTerm = useMemo(() => {
    const pct = billingTerm === 'annual' ? annualDiscountPct : 0;
    return Math.round(monthlyTotal * (1 - pct / 100) * 100) / 100;
  }, [monthlyTotal, billingTerm, annualDiscountPct]);

  const amountPerInvoice = useMemo(
    () => (billingInterval === 'yearly' ? Math.round(monthlyAfterTerm * 12 * 100) / 100 : monthlyAfterTerm),
    [monthlyAfterTerm, billingInterval],
  );

  const annualSavings = useMemo(
    () => Math.round((monthlyTotal - monthlyAfterTerm) * 12 * 100) / 100,
    [monthlyTotal, monthlyAfterTerm],
  );

  function chooseDoor(d: Door) {
    setError(null);
    setDoor(d);
    setStep('form');
  }

  function validAccount(): string | null {
    if (!companyName.trim()) return 'Le nom de la société est requis';
    if (!fullName.trim()) return 'Votre nom est requis';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'E-mail invalide';
    if (password.length < 8) return 'Le mot de passe doit faire au moins 8 caractères';
    return null;
  }

  async function submitRegister() {
    setError(null);
    setLoading(true);
    try {
      const body =
        door === 'trial'
          ? { companyName, fullName, email, password, mode: 'trial' as const }
          : {
              companyName,
              fullName,
              email,
              password,
              mode: 'direct' as const,
              modules: selected.map((m) => ({ moduleCode: m.code, seats: seats[m.code] })),
              billingTerm,
              billingInterval,
              promoCode: promoCode.trim() || null,
            };
      const res = await apiFetch<RegisterResult>('/auth/register', { method: 'POST', body });
      setSession(res.accessToken, email, res.tenantSlug);
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Inscription impossible');
      setLoading(false);
    }
  }

  function onFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validAccount();
    if (v) { setError(v); return; }
    if (door === 'trial') {
      submitRegister();
    } else {
      if (selected.length === 0) { setError('Choisissez au moins un module métier'); return; }
      setError(null);
      setStep('payment');
    }
  }

  return (
    <div className="login-wrap" style={{ padding: '32px 16px', alignItems: 'flex-start' }}>
      <div style={{ width: '100%', maxWidth: step === 'door' ? 760 : 460, marginTop: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ margin: '0 0 4px', color: 'var(--primary)' }}>ERP BTP</h1>
          <p className="muted" style={{ margin: 0 }}>Créez votre espace</p>
        </div>

        {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

        {/* ── Étape 1 : choix de la porte ── */}
        {step === 'door' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <DoorCard
              icon={<Gift size={22} />}
              title="Essayer gratuitement"
              subtitle="30 jours"
              points={[
                'Accès à TOUS les modules',
                'Aucun engagement',
                'Bascule automatique en abonnement de 1er niveau à l’échéance',
              ]}
              cta="Démarrer l’essai"
              onClick={() => chooseDoor('trial')}
            />
            <DoorCard
              icon={<CreditCard size={22} />}
              title="Choisir mon abonnement"
              subtitle="Paiement immédiat"
              points={[
                'Sélection des modules à la carte',
                'Jetons par module',
                'Démarrage immédiat en client payant',
              ]}
              cta="Choisir mes modules"
              onClick={() => chooseDoor('direct')}
              accent
            />
          </div>
        )}

        {/* ── Étape 2 : compte (+ modules si direct) ── */}
        {step === 'form' && (
          <form className="login-card" style={{ width: '100%' }} onSubmit={onFormSubmit}>
            <button type="button" className="btn-ghost" onClick={() => { setStep('door'); setError(null); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12, fontSize: 12 }}>
              <ArrowLeft size={13} /> Retour
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              {door === 'trial'
                ? <span className="badge info">Essai gratuit 30 j</span>
                : <span className="badge success">Abonnement direct</span>}
            </div>

            <div className="field">
              <CompanySearch
                label="Rechercher votre entreprise (annuaire officiel)"
                onSelect={(c) => setCompanyName(c.name)}
              />
            </div>
            <div className="field">
              <label>Société</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Ma société BTP" autoFocus />
            </div>
            <div className="field">
              <label>Votre nom</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Prénom Nom" />
            </div>
            <div className="field">
              <label>E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@societe.fr" />
            </div>
            <div className="field">
              <label>Mot de passe (8 caractères min.)</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {door === 'direct' && (
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <div className="label" style={{ marginBottom: 6 }}>Modules & jetons</div>
                <p className="muted" style={{ fontSize: 11, marginTop: 0 }}>
                  Le Socle (comptes, référentiels, e-facturation) est inclus. Choisissez vos modules métier.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {billableModules.map((m) => {
                    const on = (seats[m.code] ?? 0) > 0;
                    return (
                      <div key={m.code} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8,
                      }}>
                        <input type="checkbox" checked={on}
                          onChange={(e) => setSeats((s) => ({ ...s, [m.code]: e.target.checked ? (s[m.code] || 1) : 0 }))} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</div>
                          <div className="muted" style={{ fontSize: 11 }}>{euro(m.priceMonthly)} /siège/mois</div>
                        </div>
                        {on && (
                          <input type="number" min={1} value={seats[m.code] ?? 1} aria-label={`Jetons ${m.label}`}
                            onChange={(e) => setSeats((s) => ({ ...s, [m.code]: Math.max(1, Number(e.target.value) || 1) }))}
                            style={{ width: 54, textAlign: 'right' }} />
                        )}
                      </div>
                    );
                  })}
                </div>
                {selected.length > 0 && (
                  <div style={{ marginTop: 10, textAlign: 'right', fontWeight: 700 }}>
                    Total : {euro(monthlyTotal)} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>/mois HT</span>
                  </div>
                )}

                {/* Formule d'engagement */}
                <div className="label" style={{ marginTop: 14, marginBottom: 6 }}>Formule</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <FormuleCard
                    selected={billingTerm === 'monthly'}
                    title="Sans engagement"
                    detail="Mensuel, résiliable à tout moment"
                    price={monthlyTotal > 0 ? `${euro(monthlyTotal)} /mois` : ''}
                    onClick={() => { setBillingTerm('monthly'); setBillingInterval('monthly'); }}
                  />
                  <FormuleCard
                    selected={billingTerm === 'annual'}
                    title={`Engagement 12 mois — ${annualDiscountPct} % de remise`}
                    detail={
                      monthlyTotal > 0
                        ? `Économisez ${euro(Math.round(monthlyTotal * (annualDiscountPct / 100) * 12 * 100) / 100)} par an`
                        : 'Reconduction tacite au mois le mois à l’échéance'
                    }
                    price={monthlyTotal > 0 ? `${euro(Math.round(monthlyTotal * (1 - annualDiscountPct / 100) * 100) / 100)} /mois` : ''}
                    onClick={() => setBillingTerm('annual')}
                    accent
                  />
                </div>

                {billingTerm === 'annual' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <ChoicePill
                      selected={billingInterval === 'monthly'}
                      label="Payer mensuellement"
                      onClick={() => setBillingInterval('monthly')}
                    />
                    <ChoicePill
                      selected={billingInterval === 'yearly'}
                      label="Payer en une fois"
                      onClick={() => setBillingInterval('yearly')}
                    />
                  </div>
                )}

                <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
                  <label>Code promo (optionnel)</label>
                  <input
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    placeholder="CODE"
                    style={{ width: 160 }}
                  />
                </div>
              </div>
            )}

            <button className="btn" type="submit" disabled={loading} style={{ width: '100%', marginTop: 8 }}>
              {door === 'trial'
                ? (loading ? 'Création…' : 'Démarrer l’essai gratuit')
                : 'Continuer vers le paiement'}
            </button>
          </form>
        )}

        {/* ── Étape 3 : faux écran de paiement (direct) ── */}
        {step === 'payment' && (
          <div className="login-card" style={{ width: '100%' }}>
            <button type="button" className="btn-ghost" onClick={() => { setStep('form'); setError(null); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12, fontSize: 12 }}>
              <ArrowLeft size={13} /> Retour
            </button>
            <h2 style={{ marginTop: 0 }}>Récapitulatif</h2>
            <table className="grid" style={{ marginBottom: 12 }}>
              <tbody>
                <tr>
                  <td>Socle</td>
                  <td className="muted" style={{ textAlign: 'right' }}>Inclus</td>
                </tr>
                {selected.map((m) => (
                  <tr key={m.code}>
                    <td>{m.label} <span className="muted">× {seats[m.code]}</span></td>
                    <td style={{ textAlign: 'right' }}>{euro((m.priceMonthly ?? 0) * (seats[m.code] ?? 0))}</td>
                  </tr>
                ))}
                <tr>
                  <td>Sous-total mensuel HT</td>
                  <td style={{ textAlign: 'right' }}>{euro(monthlyTotal)}</td>
                </tr>
                {billingTerm === 'annual' && (
                  <tr>
                    <td>Remise engagement 12 mois ({annualDiscountPct} %)</td>
                    <td style={{ textAlign: 'right', color: 'var(--accent)' }}>
                      −{euro(Math.round((monthlyTotal - monthlyAfterTerm) * 100) / 100)} /mois
                    </td>
                  </tr>
                )}
                {promoCode.trim() && (
                  <tr>
                    <td className="muted">Code promo « {promoCode.trim()} »</td>
                    <td className="muted" style={{ textAlign: 'right', fontSize: 12 }}>
                      validé au paiement
                    </td>
                  </tr>
                )}
                <tr>
                  <td style={{ fontWeight: 700 }}>
                    {billingInterval === 'yearly' ? 'Total annuel HT' : 'Total mensuel HT'}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(amountPerInvoice)}</td>
                </tr>
              </tbody>
            </table>

            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px',
              background: 'var(--surface)', borderRadius: 8, marginBottom: 14,
            }}>
              <ShieldCheck size={16} style={{ color: 'var(--accent)', marginTop: 1 }} />
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                Écran de paiement de démonstration. En production, le paiement se fera par
                redirection vers la page sécurisée du prestataire (Stripe) — aucune donnée
                bancaire n’est saisie dans l’application.
              </p>
            </div>

            <p className="muted" style={{ fontSize: 11, marginTop: 0 }}>
              {billingTerm === 'annual'
                ? `Engagement de 12 mois, puis reconduction tacite au mois le mois. Économie : ${euro(annualSavings)} sur l’année.`
                : 'Sans engagement, reconduction tacite chaque mois. Résiliable à tout moment.'}
            </p>

            <button className="btn" onClick={submitRegister} disabled={loading} style={{ width: '100%' }}>
              {loading
                ? 'Traitement…'
                : `Payer ${euro(amountPerInvoice)} ${billingInterval === 'yearly' ? '/an' : '/mois'} et démarrer`}
            </button>
          </div>
        )}

        <p className="muted" style={{ textAlign: 'center', marginTop: 20, fontSize: 12 }}>
          Déjà un compte ? <Link href="/login" className="link">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}

/* ─────────── sélecteurs de formule ─────────── */
function FormuleCard({
  selected, title, detail, price, onClick, accent,
}: {
  selected: boolean; title: string; detail: string; price: string; onClick: () => void; accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%',
        padding: '10px 12px', borderRadius: 8, cursor: 'pointer', background: 'transparent',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        boxShadow: selected ? '0 0 0 1px var(--accent) inset' : 'none',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-strong, #cbd5e1)'}`,
          background: selected ? 'var(--accent)' : 'transparent',
        }}
      />
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>
          {title}
          {accent && <span className="badge success" style={{ marginLeft: 6 }}>économique</span>}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>{detail}</span>
      </span>
      {price && <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{price}</span>}
    </button>
  );
}

function ChoicePill({ selected, label, onClick }: { selected: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: '7px 10px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        background: selected ? 'var(--accent)' : 'transparent',
        color: selected ? '#fff' : 'inherit',
        fontWeight: selected ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

/* ─────────── carte de porte ─────────── */
function DoorCard(props: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  points: string[];
  cta: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <div className="login-card" style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: props.accent ? 'var(--accent)' : 'var(--primary)', color: '#fff', marginBottom: 12,
      }}>
        {props.icon}
      </div>
      <h2 style={{ margin: '0 0 2px' }}>{props.title}</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>{props.subtitle}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {props.points.map((p) => (
          <li key={p} style={{ display: 'flex', gap: 6, fontSize: 12.5 }}>
            <Check size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} /> {p}
          </li>
        ))}
      </ul>
      <button className={props.accent ? 'btn' : 'btn btn-secondary'} onClick={props.onClick} style={{ width: '100%' }}>
        {props.cta}
      </button>
    </div>
  );
}
