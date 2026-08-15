'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Gift, CreditCard, ArrowLeft, ShieldCheck } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { CompanySearch } from '@/components/CompanySearch';
import { Mfa2FASetup } from '@/components/Mfa2FASetup';

/* ─────────── types ─────────── */
interface CatalogModule {
  code: string;
  label: string;
  isAddon: boolean;
  priceMonthly: number | null;
  description: string | null;
  minTierLevel: number | null;
}
interface CatalogPack {
  code: string;
  label: string;
  tierLevel: number;
  priceMonthly: number | null;
  /** Jetons ouverts par siège, réglés par l'éditeur. */
  seatTokens: number;
  modules: string[];
  description: string | null;
}
interface RegisterResult {
  accessToken: string;
  tenantSlug: string;
  email?: string;
}
type Door = 'trial' | 'direct';
type Step = 'door' | 'form' | 'payment' | '2fa';

/* ─────────── page ─────────── */
export default function InscriptionPage() {
  const router = useRouter();
  const { setSession, token } = useAuth();

  const [step, setStep] = useState<Step>('door');
  const [door, setDoor] = useState<Door>('trial');
  // Où mener l'utilisateur une fois la 2FA (obligatoire) configurée.
  const [afterMfa, setAfterMfa] = useState('/');

  const [companyName, setCompanyName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [modules, setModules] = useState<CatalogModule[]>([]);
  const [packs, setPacks] = useState<CatalogPack[]>([]);
  /** Palier choisi, ses jetons, et les options retenues (code → jetons). */
  const [packCode, setPackCode] = useState<string>('');
  const [packSeats, setPackSeats] = useState(1);
  const [addonSeats, setAddonSeats] = useState<Record<string, number>>({});

  // Formule : engagement (mensuel sans engagement / annuel 12 mois) et rythme de facturation.
  const [billingTerm, setBillingTerm] = useState<'monthly' | 'annual'>('monthly');
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [promoCode, setPromoCode] = useState('');
  const [annualDiscountPct, setAnnualDiscountPct] = useState(10);
  // Remise du code promo validée par le serveur, pour afficher le montant réellement dû.
  const [promo, setPromo] = useState<
    {
      discountType: 'percent' | 'fixed';
      discountValue: number;
      appliesTo: 'monthly' | 'annual' | 'both';
      durationMonths: number | null;
    } | null
  >(null);
  const [promoStatus, setPromoStatus] = useState<'idle' | 'checking' | 'ok' | 'invalid'>('idle');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Public catalogue for the "direct" door (prices, config-driven — no auth).
  useEffect(() => {
    apiFetch<CatalogModule[]>('/public/catalog/modules')
      .then(setModules)
      .catch(() => setModules([]));
    apiFetch<CatalogPack[]>('/public/catalog/packs')
      .then((p) => {
        setPacks(p);
        // Présélection du palier d'entrée pour que l'écran ne soit jamais vide.
        setPackCode((cur) => cur || p[0]?.code || '');
      })
      .catch(() => setPacks([]));
    apiFetch<{ annualDiscountPct: number }>('/public/catalog/pricing')
      .then((p) => setAnnualDiscountPct(p.annualDiscountPct))
      .catch(() => undefined);
  }, []);

  // Validation du code promo côté serveur : on montre au client la remise avant paiement, sans
  // jamais laisser le navigateur dicter le prix (le serveur recalcule au paiement, source de vérité).
  useEffect(() => {
    const code = promoCode.trim();
    if (!code) { setPromo(null); setPromoStatus('idle'); return; }
    setPromoStatus('checking');
    const handle = setTimeout(async () => {
      try {
        const r = await apiFetch<{
          usable: boolean;
          discountType?: 'percent' | 'fixed';
          discountValue?: number;
          appliesTo?: 'monthly' | 'annual' | 'both';
          durationMonths?: number | null;
        }>(`/public/catalog/promo/${encodeURIComponent(code)}`);
        if (r.usable && r.discountType && typeof r.discountValue === 'number') {
          setPromo({
            discountType: r.discountType,
            discountValue: r.discountValue,
            appliesTo: r.appliesTo ?? 'both',
            durationMonths: r.durationMonths ?? null,
          });
          setPromoStatus('ok');
        } else {
          setPromo(null);
          setPromoStatus('invalid');
        }
      } catch {
        setPromo(null);
        setPromoStatus('invalid');
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [promoCode]);

  /** Options du catalogue (add-ons), avec leur palier minimum. */
  const addonCatalogue = useMemo(() => modules.filter((m) => m.isAddon), [modules]);

  const moduleLabels = useMemo(
    () => new Map(modules.map((m) => [m.code, m.label])),
    [modules],
  );

  const selectedPack = useMemo(
    () => packs.find((p) => p.code === packCode) ?? null,
    [packs, packCode],
  );
  const selectedTier = selectedPack?.tierLevel ?? 0;

  /** Options retenues, filtrées par l'éligibilité au palier choisi. */
  const selectedAddons = useMemo(
    () =>
      addonCatalogue.filter((a) => {
        const eligible = a.minTierLevel === null || selectedTier >= a.minTierLevel;
        return eligible && (addonSeats[a.code] ?? 0) > 0;
      }),
    [addonCatalogue, addonSeats, selectedTier],
  );

  /** Prix catalogue mensuel : palier × jetons + options × leurs jetons. */
  const monthlyTotal = useMemo(() => {
    const pack = (selectedPack?.priceMonthly ?? 0) * packSeats;
    const addons = selectedAddons.reduce(
      (sum, a) => sum + (a.priceMonthly ?? 0) * (addonSeats[a.code] ?? 0),
      0,
    );
    return Math.round((pack + addons) * 100) / 100;
  }, [selectedPack, packSeats, selectedAddons, addonSeats]);

  /** Mensuel après remise d'engagement, avant code promo. */
  const monthlyAfterTerm = useMemo(() => {
    const pct = billingTerm === 'annual' ? annualDiscountPct : 0;
    return Math.round(monthlyTotal * (1 - pct / 100) * 100) / 100;
  }, [monthlyTotal, billingTerm, annualDiscountPct]);

  /** Le code promo couvre-t-il la formule choisie (mensuel / annuel / les deux) ? */
  const promoApplies = useMemo(
    () => Boolean(promo && (promo.appliesTo === 'both' || promo.appliesTo === billingTerm)),
    [promo, billingTerm],
  );

  /** Mensuel réellement facturé, après cascade engagement puis code promo (miroir du serveur). */
  const monthlyNet = useMemo(() => {
    if (!promo || !promoApplies || monthlyAfterTerm <= 0) return monthlyAfterTerm;
    const reduced =
      promo.discountType === 'percent'
        ? monthlyAfterTerm * (1 - promo.discountValue / 100)
        : monthlyAfterTerm - promo.discountValue;
    return Math.max(0, Math.round(reduced * 100) / 100);
  }, [monthlyAfterTerm, promo, promoApplies]);

  /** Mois de la 1re année couverts par la remise (12 = toute la période). Miroir du serveur. */
  const promoMonths = useMemo(() => {
    if (!promo || !promoApplies) return 0;
    const n = promo.durationMonths;
    if (n === null || n === undefined) return 12;
    return Math.min(12, Math.max(1, Math.trunc(n)));
  }, [promo, promoApplies]);

  const promoLimited = promoMonths > 0 && promoMonths < 12;

  /** Total réellement payé sur les 12 premiers mois, remise limitée comprise. */
  const firstYearTotal = useMemo(
    () =>
      Math.round((monthlyAfterTerm * 12 - (monthlyAfterTerm - monthlyNet) * promoMonths) * 100) / 100,
    [monthlyAfterTerm, monthlyNet, promoMonths],
  );

  const amountPerInvoice = useMemo(
    () => (billingInterval === 'yearly' ? firstYearTotal : monthlyNet),
    [firstYearTotal, monthlyNet, billingInterval],
  );

  /** Montant des échéances suivantes, une fois la remise épuisée. */
  const amountAfterPromo = useMemo(
    () =>
      billingInterval === 'yearly'
        ? Math.round(monthlyAfterTerm * 12 * 100) / 100
        : promoLimited ? monthlyAfterTerm : monthlyNet,
    [billingInterval, monthlyAfterTerm, monthlyNet, promoLimited],
  );

  const annualSavings = useMemo(
    () => Math.round((monthlyTotal * 12 - firstYearTotal) * 100) / 100,
    [monthlyTotal, firstYearTotal],
  );

  /** « 1er mois » / « 2 premiers mois » — libellé partagé par l'aide et le récapitulatif. */
  const promoDureeLabel = promoLimited
    ? promoMonths === 1 ? '1er mois' : `${promoMonths} premiers mois`
    : null;

  function chooseDoor(d: Door) {
    setError(null);
    setDoor(d);
    setStep('form');
  }

  function validAccount(): string | null {
    if (!companyName.trim()) return 'Le nom de la société est requis';
    if (!firstName.trim()) return 'Votre prénom est requis';
    if (!lastName.trim()) return 'Votre nom est requis';
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
          ? { companyName, firstName, lastName, email, password, mode: 'trial' as const }
          : {
              companyName,
              firstName,
              lastName,
              email,
              password,
              mode: 'direct' as const,
              packCode,
              packSeats,
              addons: selectedAddons.map((a) => ({ moduleCode: a.code, seats: addonSeats[a.code] })),
              billingTerm,
              billingInterval,
              promoCode: promoCode.trim() || null,
            };
      const res = await apiFetch<RegisterResult>('/auth/register', { method: 'POST', body });
      setSession(res.accessToken, email, res.tenantSlug);
      // La double authentification est OBLIGATOIRE dès la souscription : le compte est créé, mais
      // on impose la configuration 2FA avant de laisser entrer dans l'application. La destination
      // finale (règlement pour la porte 2, tableau de bord sinon) est jouée à la fin de l'étape.
      setAfterMfa(door === 'direct' ? '/abonnement' : '/');
      setLoading(false);
      setStep('2fa');
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
      if (!packCode) { setError('Choisissez une formule'); return; }
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
                'Accès ouvert dès le premier paiement',
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
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Prénom</label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Marie" />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Nom</label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Durand" />
              </div>
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
                <div className="label" style={{ marginBottom: 6 }}>Votre formule</div>
                <p className="muted" style={{ fontSize: 11, marginTop: 0 }}>
                  Chaque palier ajoute un maillon : chiffrer → facturer → suivre le chantier → piloter la marge.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {packs.map((p) => (
                    <PackCard
                      key={p.code}
                      pack={p}
                      selected={packCode === p.code}
                      moduleLabels={moduleLabels}
                      onClick={() => setPackCode(p.code)}
                    />
                  ))}
                </div>

                <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
                  <label>Nombre de sièges</label>
                  <input
                    type="number"
                    min={1}
                    value={packSeats}
                    aria-label="Sièges du palier"
                    onChange={(e) => setPackSeats(Math.max(1, Number(e.target.value) || 1))}
                    style={{ width: 80, textAlign: 'right' }}
                  />
                  {/* Un siège ouvre un jeton par module du palier : on l'annonce à l'achat, pas
                      après. Le client sait ainsi combien d'accès il achète réellement. */}
                  {selectedPack && selectedPack.seatTokens > 0 && (
                    <span className="muted" style={{ fontSize: 11 }}>
                      Chaque siège ouvre {selectedPack.seatTokens} jetons, à répartir librement
                      entre vos collaborateurs et vos modules — soit{' '}
                      {packSeats * selectedPack.seatTokens} jetons au total.
                    </span>
                  )}
                </div>

                {/* Options à la carte, conditionnées au palier choisi */}
                {addonCatalogue.length > 0 && (
                  <>
                    <div className="label" style={{ marginTop: 14, marginBottom: 6 }}>
                      Options (facultatives)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {addonCatalogue.map((a) => {
                        const eligible = a.minTierLevel === null || selectedTier >= a.minTierLevel;
                        const on = (addonSeats[a.code] ?? 0) > 0;
                        const requiredPack = packs.find((p) => p.tierLevel === a.minTierLevel);
                        return (
                          <div key={a.code} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                            border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                            borderRadius: 8, opacity: eligible ? 1 : 0.55,
                          }}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={!eligible}
                              aria-label={`Option ${a.label}`}
                              onChange={(e) =>
                                setAddonSeats((s) => ({ ...s, [a.code]: e.target.checked ? (s[a.code] || 1) : 0 }))
                              }
                            />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{a.label}</div>
                              <div className="muted" style={{ fontSize: 11 }}>
                                {eligible
                                  ? a.priceMonthly === null
                                    ? 'Sur devis'
                                    : `${euro(a.priceMonthly)} /siège/mois`
                                  : `Nécessite au minimum le palier ${requiredPack?.label ?? a.minTierLevel}`}
                              </div>
                            </div>
                            {on && eligible && a.priceMonthly !== null && (
                              <input
                                type="number" min={1} value={addonSeats[a.code] ?? 1}
                                aria-label={`Jetons ${a.label}`}
                                onChange={(e) =>
                                  setAddonSeats((s) => ({ ...s, [a.code]: Math.max(1, Number(e.target.value) || 1) }))
                                }
                                style={{ width: 54, textAlign: 'right' }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {monthlyTotal > 0 && (
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
                  {promoStatus === 'checking' && (
                    <span className="muted" style={{ fontSize: 11 }}>Vérification…</span>
                  )}
                  {promoStatus === 'ok' && promo && promoApplies && (
                    <span style={{ fontSize: 11, color: 'var(--success)' }}>
                      ✓ Remise appliquée{promo.discountType === 'percent'
                        ? ` : −${promo.discountValue} %`
                        : ` : −${euro(promo.discountValue)}/mois`}
                      {promoDureeLabel ? ` — ${promoDureeLabel}` : ''}
                    </span>
                  )}
                  {promoStatus === 'ok' && promo && !promoApplies && (
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>
                      Ce code s’applique uniquement à l’abonnement{' '}
                      {promo.appliesTo === 'annual' ? 'annuel (engagement 12 mois)' : 'mensuel (sans engagement)'}.
                    </span>
                  )}
                  {promoStatus === 'invalid' && (
                    <span style={{ fontSize: 11, color: 'var(--danger, #dc2626)' }}>
                      Code inconnu ou expiré.
                    </span>
                  )}
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
                {selectedPack && (
                  <tr>
                    <td>
                      <strong>{selectedPack.label}</strong> <span className="muted">× {packSeats}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {euro((selectedPack.priceMonthly ?? 0) * packSeats)}
                    </td>
                  </tr>
                )}
                {selectedAddons.map((a) => (
                  <tr key={a.code}>
                    <td>{a.label} <span className="muted">× {addonSeats[a.code]}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      {a.priceMonthly === null ? 'Sur devis' : euro(a.priceMonthly * (addonSeats[a.code] ?? 0))}
                    </td>
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
                {promo && promoApplies && monthlyAfterTerm - monthlyNet > 0 && (
                  <tr>
                    <td>
                      Code promo « {promoCode.trim()} »
                      {promo.discountType === 'percent' ? ` (${promo.discountValue} %)` : ''}
                      {promoDureeLabel && (
                        <span className="muted" style={{ fontSize: 11 }}> — {promoDureeLabel}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--accent)' }}>
                      −{euro(Math.round((monthlyAfterTerm - monthlyNet) * 100) / 100)}
                      {promoLimited ? ` × ${promoMonths}` : ' /mois'}
                    </td>
                  </tr>
                )}
                {promo && !promoApplies && (
                  <tr>
                    <td className="muted">Code promo « {promoCode.trim()} »</td>
                    <td className="muted" style={{ textAlign: 'right', fontSize: 12 }}>
                      réservé à l’abonnement {promo.appliesTo === 'annual' ? 'annuel' : 'mensuel'}
                    </td>
                  </tr>
                )}
                {promoCode.trim() && !promo && (
                  <tr>
                    <td className="muted">Code promo « {promoCode.trim()} »</td>
                    <td className="muted" style={{ textAlign: 'right', fontSize: 12 }}>
                      {promoStatus === 'checking' ? 'vérification…' : 'code inconnu ou expiré'}
                    </td>
                  </tr>
                )}
                <tr>
                  <td style={{ fontWeight: 700 }}>
                    {billingInterval === 'yearly'
                      ? 'Total 1re année HT'
                      : promoLimited
                        ? `Total mensuel HT (${promoDureeLabel})`
                        : 'Total mensuel HT'}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{euro(amountPerInvoice)}</td>
                </tr>
                {/* Une remise limitée s'arrête : on dit tout de suite ce qui sera payé ensuite,
                    plutôt que de laisser le client découvrir l'augmentation sur sa facture. */}
                {promoLimited && (
                  <tr>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {billingInterval === 'yearly'
                        ? 'Puis, à partir de la 2e année'
                        : `Puis à partir du ${promoMonths + 1}e mois`}
                    </td>
                    <td className="muted" style={{ textAlign: 'right', fontSize: 12 }}>
                      {euro(amountAfterPromo)} {billingInterval === 'yearly' ? '/an' : '/mois'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px',
              background: 'var(--surface)', borderRadius: 8, marginBottom: 14,
            }}>
              <ShieldCheck size={16} style={{ color: 'var(--accent)', marginTop: 1 }} />
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                Nous créons d’abord votre espace, puis vous réglez la première échéance. Vos
                modules s’ouvrent une fois le paiement encaissé — aucune donnée bancaire n’est
                saisie dans l’application : le règlement se fait chez notre prestataire.
              </p>
            </div>

            <p className="muted" style={{ fontSize: 11, marginTop: 0 }}>
              {billingTerm === 'annual'
                ? `Engagement de 12 mois, puis reconduction tacite au mois le mois. Économie : ${euro(annualSavings)} sur l’année.`
                : 'Sans engagement, reconduction tacite chaque mois. Résiliable à tout moment.'}
            </p>

            <button className="btn" onClick={submitRegister} disabled={loading} style={{ width: '100%' }}>
              {loading
                ? 'Création de votre espace…'
                : `Créer mon espace et régler ${euro(amountPerInvoice)} ${billingInterval === 'yearly' ? '/an' : '/mois'}`}
            </button>
          </div>
        )}

        {step === '2fa' && (
          <div className="login-card" style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <ShieldCheck size={18} style={{ color: 'var(--accent)' }} />
              <h2 style={{ margin: 0 }}>Sécurisez votre compte</h2>
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
              La double authentification est <strong>obligatoire</strong> pour protéger les données
              de votre entreprise. Cette étape ne prend qu’une minute et ne se fait qu’une fois.
            </p>
            <Mfa2FASetup token={token} onDone={() => router.push(afterMfa)} />
          </div>
        )}

        {step !== '2fa' && (
          <p className="muted" style={{ textAlign: 'center', marginTop: 20, fontSize: 12 }}>
            Déjà un compte ? <Link href="/login" className="link">Se connecter</Link>
          </p>
        )}
      </div>
    </div>
  );
}

/* ─────────── carte de palier ─────────── */
function PackCard({
  pack, selected, moduleLabels, onClick,
}: {
  pack: CatalogPack;
  selected: boolean;
  moduleLabels: Map<string, string>;
  onClick: () => void;
}) {
  // Le Socle est le tronc commun : on ne le liste pas, on le mentionne.
  const shown = pack.modules.filter((c) => c !== 'core');
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', width: '100%',
        padding: '10px 12px', borderRadius: 8, cursor: 'pointer', background: 'transparent',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        boxShadow: selected ? '0 0 0 1px var(--accent) inset' : 'none',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14, height: 14, borderRadius: '50%', flexShrink: 0, marginTop: 3,
          border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-strong, #cbd5e1)'}`,
          background: selected ? 'var(--accent)' : 'transparent',
        }}
      />
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>{pack.label}</span>
        {pack.description && (
          <span className="muted" style={{ fontSize: 11, display: 'block' }}>{pack.description}</span>
        )}
        <span className="muted" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
          Socle inclus{shown.length > 0 ? ' + ' : ''}
          {shown.map((c) => moduleLabels.get(c) ?? c).join(' + ')}
        </span>
      </span>
      <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
        {euro(pack.priceMonthly)}
        <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}> /siège</span>
      </span>
    </button>
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
