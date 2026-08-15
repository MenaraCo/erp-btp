'use client';

import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2, Sparkles, CreditCard, FlaskConical } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { euro } from '@/lib/format';
import { MODULES, moduleLabel } from '@/lib/modules';
import { InfoBulle } from '@/components/InfoBulle';

/* ─────────── types ─────────── */
interface Subscription {
  id: string;
  status: 'incomplete' | 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';
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
  /** Jetons ouverts par siège, réglés par l'éditeur. */
  seatTokens: number;
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
interface Devis {
  intitule: string;
  montantCentimes: number;
  periode: 'month' | 'year';
  lignes: Array<{ libelle: string; jetons: number; prixUnitaire: number; total: number }>;
  mensuelBase: number;
  remisePct: number;
  mensuelApresEngagement: number;
  promoCode: {
    code: string;
    discountType: 'percent' | 'fixed';
    discountValue: number;
    durationMonths: number | null;
  } | null;
  promoMois: number;
  promoLimitee: boolean;
  montantCentimesApresPromo: number;
  mensuelNet: number;
}
interface SeatPool {
  total: number;
  used: number;
  remaining: number;
  packModules: string[];
}
interface EtatPaiement {
  /** Prestataire de substitution : aucun euro ne circule, tout se teste par des boutons. */
  fictif: boolean;
  devis: Devis | null;
  /** Pourquoi il n'y a rien à prélever, le cas échéant. */
  motif: string | null;
}

/* ─────────── helpers ─────────── */
const STATUS_LABELS: Record<Subscription['status'], string> = {
  incomplete: 'En attente du premier paiement',
  trialing: 'Essai en cours',
  active: 'Abonnement actif',
  past_due: 'Paiement en attente',
  paused: 'En pause',
  canceled: 'Résilié',
};
const STATUS_BADGE: Record<Subscription['status'], string> = {
  incomplete: 'warning',
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

/**
 * Invitation affichée quand on arrive d'une tuile non souscrite. Elle nomme le module et dit ce
 * qu'il apporte : une tuile grisée sans explication ne donne envie de rien.
 */
function InvitationModule({ label, tagline }: { label: string; tagline: string }) {
  return (
    <div
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        border: '1px solid var(--accent)', borderRadius: 10,
        background: '#fff7ed', padding: '14px 16px', marginBottom: 22,
      }}
    >
      <Sparkles size={18} color="var(--accent)" style={{ flexShrink: 0, marginTop: 1 }} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--primary)' }}>
          Le module «&nbsp;{label}&nbsp;» n’est pas encore dans votre abonnement
        </div>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.45 }}>
          {tagline}. Nous pensons que le moment est venu&nbsp;: ajoutez-le ci-dessous et il
          s’ouvrira immédiatement pour les utilisateurs à qui vous affecterez un jeton.
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
const TABS = ['État', 'Formule & Options'] as const;
type Tab = (typeof TABS)[number];

export default function AbonnementPage() {
  const [tab, setTab] = useState<Tab>('État');
  const { token } = useAuth();
  // Arrivée depuis une tuile grisée du menu de démarrage : on nomme le module convoité et on
  // ouvre directement l'onglet où il se souscrit, plutôt que de laisser l'utilisateur le chercher.
  const decouvrir = useSearchParams().get('decouvrir');
  const moduleVise = MODULES.find((m) => m.key === decouvrir);

  return (
    <div style={{ padding: '20px 24px', maxWidth: 960 }}>
      <h1 style={{ margin: '0 0 4px' }}>Abonnement</h1>
      <p className="muted" style={{ margin: '0 0 20px' }}>
        État de votre souscription, modules et affectation des jetons
      </p>

      {moduleVise && <InvitationModule label={moduleVise.label} tagline={moduleVise.tagline} />}

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
  const pool = useQuery({
    queryKey: ['seats-pool'],
    queryFn: () => api<SeatPool>('/seats/pool'),
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

        {s.status === 'incomplete' && (
          <p style={{ margin: '0 0 8px' }}>
            <strong>Votre formule est réservée.</strong>{' '}
            <span className="muted">
              Les modules s’ouvriront dès le premier paiement encaissé — réglez-le ci-dessous.
              Vos choix sont conservés, rien n’est perdu si vous revenez plus tard.
            </span>
          </p>
        )}

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
            // Rien à résilier tant que rien n'a été payé : il n'y a pas encore de période.
            s.status !== 'canceled' && s.status !== 'incomplete' && (
              <button className="btn btn-danger" onClick={() => { setErr(null); cancel.mutate(true); }} disabled={cancel.isPending}>
                Résilier à la fin de la période
              </button>
            )
          )}
        </div>
      </div>

      <CartePaiement />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Modules actifs ({activeModules.length})</h2>
        {/* La contrainte est la réserve commune, pas un quota par module : afficher « 4/5 » en face
            de chaque module laisserait croire à une limite qui n'existe plus. */}
        {pool.data && pool.data.total > 0 && (
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
            Réserve de jetons : <strong>{pool.data.remaining}</strong> disponible
            {pool.data.remaining > 1 ? 's' : ''} sur {pool.data.total}.
          </p>
        )}
        {activeModules.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Aucun module actif.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {activeModules.map((m) => {
              const option = !(pool.data?.packModules.includes(m.moduleCode) ?? false);
              return (
                <li key={m.moduleCode} style={{ marginBottom: 4 }}>
                  <strong>{moduleLabel(m.moduleCode)}</strong>{' '}
                  <span className="muted">
                    {option
                      ? `— option, ${m.seatsAssigned}/${m.seatsPurchased} jetons affectés`
                      : `— ${m.seatsAssigned} utilisateur${m.seatsAssigned > 1 ? 's' : ''}`}
                  </span>
                  {m.readOnly && <span className="badge warning" style={{ marginLeft: 8 }}>lecture seule</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ─────────── Paiement ─────────── */
/**
 * Payer son abonnement.
 *
 * Le montant affiché ici vient du serveur, jamais d'un calcul de l'écran : c'est le même chiffre
 * qui sera présenté au prestataire. Et le paiement se fait par REDIRECTION — aucune carte n'est
 * jamais saisie dans l'application.
 *
 * Tant que le prestataire de substitution est actif, un banc d'essai permet de dérouler tout le
 * parcours (retour de paiement, échec, résiliation) sans compte, sans clé et sans un euro.
 */
function CartePaiement() {
  const api = useApi();
  const qc = useQueryClient();
  const retour = useSearchParams().get('paiement');
  const [err, setErr] = useState<string | null>(null);
  const [avis, setAvis] = useState<string | null>(null);
  /** Session ouverte en mode fictif : il n'y a pas de page externe, on la joue sur place. */
  const [sessionFictive, setSessionFictive] = useState<{ sessionId: string } | null>(null);

  const etat = useQuery({
    queryKey: ['paiement-devis'],
    queryFn: () => api<EtatPaiement>('/abonnement/paiement/devis'),
  });

  const payer = useMutation({
    mutationFn: () =>
      api<{ url: string; sessionId: string }>('/abonnement/paiement/session', { method: 'POST' }),
    onSuccess: (r) => {
      setAvis(null);
      // Sans prestataire réel, il n'existe aucune page à visiter : rediriger mènerait dans le
      // vide. On joue le guichet sur place, avec la session réellement créée par l'API.
      if (etat.data?.fictif) {
        setSessionFictive({ sessionId: r.sessionId });
        return;
      }
      // Sinon on quitte l'application : c'est chez le prestataire que la carte se saisit.
      window.location.href = r.url;
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Ouverture du paiement impossible.'),
  });

  const simuler = useMutation({
    mutationFn: (type: string) =>
      api('/abonnement/paiement/simuler', { method: 'POST', body: { type } }),
    onSuccess: (_r, type) => {
      setErr(null);
      setSessionFictive(null);
      setAvis(
        type === 'paiement_reussi'
          ? 'Paiement confirmé par le prestataire : l’abonnement est actif.'
          : type === 'paiement_echoue'
            ? 'Prélèvement refusé : l’abonnement passe en impayé, sans coupure d’accès.'
            : 'Résiliation enregistrée chez le prestataire.',
      );
      qc.invalidateQueries({ queryKey: ['subscription'] });
      qc.invalidateQueries({ queryKey: ['paiement-devis'] });
      // Un premier paiement ouvre les modules et attribue les jetons : la liste des modules
      // ET les droits de l'utilisateur changent au même instant. Sans cela, le client vient de
      // payer et continue de voir « aucun module actif ».
      qc.invalidateQueries({ queryKey: ['subscription-modules'] });
      qc.invalidateQueries({ queryKey: ['seats'] });
      qc.invalidateQueries({ queryKey: ['me-capabilities'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Simulation impossible.'),
  });

  if (etat.isLoading || etat.isError) return null;
  const d = etat.data?.devis ?? null;
  const parPeriode = d?.periode === 'year' ? 'an' : 'mois';

  return (
    <div className="card">
      <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <CreditCard size={16} /> Paiement
      </h2>

      {retour === 'ok' && (
        <div className="badge info" style={{ display: 'block', marginBottom: 12, padding: '8px 10px' }}>
          Retour de la page de paiement. L’abonnement ne bascule qu’à réception de la confirmation
          du prestataire — quelques secondes en général.
        </div>
      )}
      {retour === 'annule' && (
        <div className="badge warning" style={{ display: 'block', marginBottom: 12, padding: '8px 10px' }}>
          Paiement abandonné. Rien n’a été prélevé, rien n’a changé.
        </div>
      )}
      {err && <div className="error">{err}</div>}
      {avis && (
        <div className="badge info" style={{ display: 'block', marginBottom: 12, padding: '8px 10px' }}>
          {avis}
        </div>
      )}

      {!d ? (
        <p className="muted" style={{ margin: 0 }}>{etat.data?.motif ?? 'Rien à prélever pour l’instant.'}</p>
      ) : (
        <>
          <table className="grid" style={{ marginBottom: 12 }}>
            <tbody>
              {d.lignes.map((l) => (
                <tr key={l.libelle}>
                  <td>{l.libelle}</td>
                  <td className="muted" style={{ textAlign: 'right' }}>
                    {l.jetons} × {euro(l.prixUnitaire)}
                  </td>
                  <td style={{ textAlign: 'right', width: 90 }}>{euro(l.total)}</td>
                </tr>
              ))}
              {d.remisePct > 0 && (
                <tr>
                  <td colSpan={2} className="muted">Remise engagement annuel ({d.remisePct} %)</td>
                  <td style={{ textAlign: 'right' }}>−{euro(d.mensuelBase - d.mensuelApresEngagement)}</td>
                </tr>
              )}
              {d.promoCode && d.mensuelApresEngagement - d.mensuelNet > 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    Code promo « {d.promoCode.code} »
                    {d.promoCode.discountType === 'percent'
                      ? ` (${d.promoCode.discountValue} %)`
                      : ''}
                    {d.promoLimitee
                      ? ` — ${d.promoMois === 1 ? '1er mois' : `${d.promoMois} premiers mois`}`
                      : ''}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--accent)' }}>
                    −{euro(d.mensuelApresEngagement - d.mensuelNet)}
                  </td>
                </tr>
              )}
              <tr>
                <td colSpan={2} style={{ fontWeight: 700 }}>Prochaine échéance</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>
                  {euro(d.montantCentimes / 100)}<span className="muted" style={{ fontWeight: 400 }}> /{parPeriode}</span>
                </td>
              </tr>
              {/* La remise s'arrête avant la fin : on annonce le montant suivant plutôt que de
                  laisser le client le découvrir sur son relevé. */}
              {d.promoLimitee && (
                <tr>
                  <td colSpan={2} className="muted" style={{ fontSize: 12 }}>
                    Puis, une fois la remise épuisée
                  </td>
                  <td className="muted" style={{ textAlign: 'right', fontSize: 12 }}>
                    {euro(d.montantCentimesApresPromo / 100)} /{parPeriode}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {sessionFictive ? (
            /* Le guichet du prestataire, joué sur place : en fictif il n'existe aucune page
               externe, et rediriger vers une adresse inventée n'aboutirait nulle part. */
            <div style={{
              border: '1px solid var(--accent)', borderRadius: 10, padding: '14px 16px',
              background: 'var(--surface-2, #fff7ed)',
            }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                Guichet de paiement (simulation)
              </div>
              <p className="muted" style={{ fontSize: 11.5, margin: '0 0 10px' }}>
                Session <code>{sessionFictive.sessionId}</code> — chez le vrai prestataire, c’est
                ici que la carte serait saisie, sur son site et non sur le nôtre.
              </p>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
                {euro(d.montantCentimes / 100)}
                <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> /{parPeriode}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" disabled={simuler.isPending}
                  onClick={() => simuler.mutate('paiement_reussi')}>
                  {simuler.isPending ? 'Traitement…' : 'Confirmer le paiement'}
                </button>
                <button className="btn btn-secondary" disabled={simuler.isPending}
                  onClick={() => {
                    setSessionFictive(null);
                    setAvis('Paiement abandonné. Rien n’a été prélevé, rien n’a changé.');
                  }}>
                  Abandonner
                </button>
              </div>
            </div>
          ) : (
            <>
              <button className="btn" disabled={payer.isPending} onClick={() => { setErr(null); payer.mutate(); }}>
                {payer.isPending ? 'Ouverture…' : 'Payer par carte'}
              </button>
              <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
                {etat.data?.fictif
                  ? 'Aucun prestataire réel n’est configuré : le guichet est simulé sur place, rien n’est encaissé.'
                  : 'Vous êtes redirigé vers notre prestataire de paiement. Aucune coordonnée bancaire n’est saisie ni conservée dans l’application.'}
              </p>
            </>
          )}
        </>
      )}

      {etat.data?.fictif && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 12.5 }}>
            <FlaskConical size={14} color="var(--accent)" /> Banc d’essai — paiement fictif
          </div>
          <p className="muted" style={{ fontSize: 11.5, margin: '4px 0 10px', lineHeight: 1.5 }}>
            Aucun prestataire réel n’est configuré : rien n’est encaissé. Ces boutons émettent
            l’événement qu’enverrait la banque, en passant par la même vérification de signature
            qu’en production — de quoi voir l’abonnement réagir pour de vrai.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" disabled={simuler.isPending}
              onClick={() => simuler.mutate('paiement_reussi')}>
              Simuler un paiement réussi
            </button>
            <button className="btn btn-secondary" disabled={simuler.isPending}
              onClick={() => simuler.mutate('paiement_echoue')}>
              Simuler un échec de prélèvement
            </button>
            <button className="btn btn-secondary" disabled={simuler.isPending}
              onClick={() => simuler.mutate('abonnement_annule')}>
              Simuler une résiliation
            </button>
          </div>
        </div>
      )}
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
  // Descriptions du catalogue : elles ne s'affichent qu'à la demande, derrière le « ⓘ ».
  const description = useMemo(() => {
    const map = new Map((catalog.data ?? []).map((m) => [m.code, m.description]));
    return (code: string) => map.get(code) ?? null;
  }, [catalog.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sub-pack-state'] });
    qc.invalidateQueries({ queryKey: ['sub-addons'] });
    qc.invalidateQueries({ queryKey: ['subscription-modules'] });
    qc.invalidateQueries({ queryKey: ['subscription'] });
    qc.invalidateQueries({ queryKey: ['seats'] });
    // Changer de palier ou d'option change le montant à prélever : le devis affiché suit.
    qc.invalidateQueries({ queryKey: ['paiement-devis'] });
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
  // Jetons ouverts par siège pour le palier souscrit : c'est ce qui multiplie les sièges.
  const packModuleCount =
    (packs.data ?? []).find((p) => p.code === st?.packCode)?.seatTokens ?? 0;
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
            <span className="muted">
              · {st.packSeats} siège{st.packSeats > 1 ? 's' : ''}
              {packModuleCount > 0 && ` × ${packModuleCount} jetons = ${st.packSeats * packModuleCount} jetons`}
            </span>
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
                  {/* Le nombre de jetons qu'ouvre un siège distingue deux paliers autant que
                      leur contenu : il doit se lire ici, au moment du choix. La composition,
                      elle, ne sert qu'en cas de doute : elle vit dans le « ⓘ ». */}
                  {p.seatTokens > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--accent)' }}>
                      {p.seatTokens} jetons par siège
                    </div>
                  )}
                </div>
                <InfoBulle label={`Ce que contient ${p.label}`}>
                  <strong style={{ display: 'block', marginBottom: 4 }}>Modules inclus</strong>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li>Socle</li>
                    {included.map((c) => <li key={c}>{moduleLabels.get(c) ?? c}</li>)}
                  </ul>
                </InfoBulle>
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
          <label>Nombre de sièges</label>
          <input
            type="number" min={1} value={seats}
            aria-label="Sièges du palier"
            onChange={(e) => setSeatDraft(e.target.value)}
            style={{ width: 90, textAlign: 'right' }}
          />
          {/* Le prix est au siège, mais un siège ouvre autant de jetons que le palier a de
              modules : sans cette phrase, « 5 » se lit « 5 accès » alors qu'il en donne 5 × M. */}
          {packModuleCount > 0 && (
            <span className="muted" style={{ fontSize: 11 }}>
              Chaque siège ouvre {packModuleCount} jetons, à répartir librement entre vos
              collaborateurs et vos modules — soit{' '}
              {Math.max(1, Number(seats) || 1) * packModuleCount} jetons au total.
            </span>
          )}
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
                {description(a.code) && (
                  <InfoBulle label={`À quoi sert ${a.label}`}>
                    <strong style={{ display: 'block', marginBottom: 2 }}>{a.label}</strong>
                    {description(a.code)}
                  </InfoBulle>
                )}
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
  // Les jetons du palier forment un POOL COMMUN : ce compteur est la vraie contrainte, pas le
  // nombre de jetons posés module par module.
  const pool = useQuery({
    queryKey: ['seats-pool'],
    queryFn: () => api<SeatPool>('/seats/pool'),
  });

  const assign = useMutation({
    mutationFn: (v: { moduleCode: string; userId: string }) =>
      api('/seats', { method: 'POST', body: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seats'] });
      qc.invalidateQueries({ queryKey: ['seats-pool'] });
      qc.invalidateQueries({ queryKey: ['subscription-modules'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Erreur'),
  });
  const unassign = useMutation({
    mutationFn: (id: string) => api(`/seats/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seats'] });
      qc.invalidateQueries({ queryKey: ['seats-pool'] });
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
        Un utilisateur accède à un module uniquement si un jeton lui est affecté sur ce module.
        Vos jetons forment une <strong>réserve commune</strong> : chaque jeton posé, quel que soit
        le module, diminue d’autant ce qu’il vous reste.
      </p>

      {pool.data && pool.data.total > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px',
          marginBottom: 16, background: 'var(--surface)',
        }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
              {pool.data.remaining}
              <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}> / {pool.data.total}</span>
            </div>
            <div className="muted" style={{ fontSize: 11 }}>jetons disponibles</div>
          </div>
          {/* Jauge : d'un coup d'œil, ce qui est consommé. */}
          <div style={{ flex: 1, minWidth: 160, height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, (pool.data.used / pool.data.total) * 100)}%`,
              height: '100%',
              background: pool.data.remaining === 0 ? 'var(--danger, #dc2626)' : 'var(--accent)',
            }} />
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            {pool.data.used} affecté{pool.data.used > 1 ? 's' : ''}
          </span>
        </div>
      )}
      {err && <div className="error">{err}</div>}

      {activeModules.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>Aucun module actif. Souscrivez un module ci-dessus.</p>
      )}

      {activeModules.map((m) => {
        const assigned = seatsByModule.get(m.moduleCode) ?? [];
        const assignedUserIds = new Set(assigned.map((a) => a.userId));
        const available = (users.data ?? []).filter((u) => !assignedUserIds.has(u.id));
        // Un module du palier puise dans la réserve commune ; une option garde sa propre limite.
        const dansLePalier = pool.data?.packModules.includes(m.moduleCode) ?? false;
        const full = dansLePalier
          ? (pool.data?.remaining ?? 0) <= 0
          : m.seatsAssigned >= m.seatsPurchased;
        return (
          <div key={m.moduleCode} style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <strong>{moduleLabel(m.moduleCode)}</strong>
              <span className="badge info">
                {dansLePalier
                  ? `${m.seatsAssigned} utilisateur${m.seatsAssigned > 1 ? 's' : ''}`
                  : `${m.seatsAssigned}/${m.seatsPurchased} jetons`}
              </span>
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
                  <Lock size={12} />
                  {dansLePalier
                    ? 'Votre réserve de jetons est épuisée. Retirez un jeton ailleurs, ou augmentez le nombre de jetons de votre formule.'
                    : 'Tous les jetons de cette option sont affectés. Ajustez-en le nombre pour en affecter plus.'}
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
