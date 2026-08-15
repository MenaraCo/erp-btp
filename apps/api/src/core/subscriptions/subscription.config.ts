/**
 * Subscription policy constants. The 30-day trial unlocks ALL modules with a generous but
 * bounded seat count (anti-abuse). Whether a payment method is required at sign-up is a
 * configuration flag (env: TRIAL_REQUIRES_PAYMENT_METHOD, default false) — never hard-coded
 * "no card" in the flow (cahier des charges §3.3).
 */
/**
 * Durée d'essai par DÉFAUT, en jours. La valeur réellement appliquée est le réglage éditeur
 * (`platform_setting.trial_days`, voir PricingService) ; celle-ci ne sert que de repli.
 */
export const TRIAL_DAYS = 30;

/** Generous but bounded number of seats granted per module during the trial. */
export const TRIAL_SEATS_PER_MODULE = 5;

/** Generous trial quota limits, keyed by quota_definition.key. */
export const TRIAL_QUOTAS: Record<string, number> = {
  max_active_projects: 50,
  storage_gb: 10,
  api_rate_limit: 120,
};

export type SubscriptionStatus =
  /**
   * Souscription enregistrée, en attente du PREMIER paiement (porte 2). Les modules sont
   * choisis mais restent fermés : sans cet état, s'inscrire suffirait à obtenir un compte
   * payant sans payer. Seul le webhook du prestataire peut la faire passer en `active`.
   */
  | 'incomplete'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'canceled';
