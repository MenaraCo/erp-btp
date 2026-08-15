/**
 * Moteur de tarification d'une souscription — source unique de vérité du prix.
 *
 * Deux axes indépendants (cahier des charges §3.2/§3.4) :
 *  - **engagement** (`billingTerm`) : `monthly` (sans engagement) ou `annual` (12 mois) ;
 *  - **rythme de facturation** (`billingInterval`) : `monthly` (mensualisé) ou `yearly` (payé
 *    en une fois). Un abonnement sans engagement ne peut être facturé qu'au mois.
 *
 * L'engagement annuel ouvre droit à une remise (10 % par défaut, **paramétrable** — jamais codée
 * en dur). Les remises se cumulent **en cascade** : remise d'engagement d'abord, puis le code
 * promo sur le montant déjà remisé.
 *
 * Le MRR est toujours exprimé en **équivalent mensuel** (un annuel payé d'avance compte pour
 * annuel ÷ 12), pratique standard qui rend les formules comparables.
 */

export type BillingTerm = 'monthly' | 'annual';
export type BillingInterval = 'monthly' | 'yearly';

export type PromoAppliesTo = 'monthly' | 'annual' | 'both';

export interface PromoDiscount {
  discountType: 'percent' | 'fixed';
  discountValue: number;
  /** Portée : `monthly` (sans engagement), `annual` (engagement), `both`/absent (les deux). */
  appliesTo?: PromoAppliesTo;
  /**
   * Durée de la remise, en mois. `null`/absent = toute la période (comportement historique) ;
   * N = seulement les N premiers mois (offre de lancement : 1er mois, 2 premiers mois…).
   */
  durationMonths?: number | null;
}

/** Le code promo s'applique-t-il à la formule d'engagement choisie ? */
export function promoAppliesToTerm(promo: PromoDiscount | null | undefined, term: BillingTerm): boolean {
  if (!promo) return false;
  const scope = promo.appliesTo ?? 'both';
  if (scope === 'both') return true;
  return scope === term;
}

/**
 * Nombre de mois de la PREMIÈRE ANNÉE couverts par la remise promo.
 * 0 si le code ne s'applique pas ; 12 s'il court sur toute la période ; N s'il est limité.
 */
export function promoMonthsCovered(promo: PromoDiscount | null | undefined): number {
  if (!promo) return 0;
  const raw = promo.durationMonths;
  if (raw === null || raw === undefined) return MONTHS_PER_YEAR;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(MONTHS_PER_YEAR, n);
}

export interface PricingInput {
  /** Lignes actives : nombre de jetons × prix unitaire €HT/siège/mois. */
  lines: Array<{ seats: number; unitPrice: number }>;
  billingTerm: BillingTerm;
  billingInterval: BillingInterval;
  /** Remise d'engagement annuel en %, paramétrable (défaut applicatif : 10). */
  annualDiscountPct: number;
  promo?: PromoDiscount | null;
}

export interface PricingResult {
  /** Prix mensuel catalogue, avant toute remise. */
  monthlyBase: number;
  /** Remise d'engagement appliquée, en % (0 si sans engagement). */
  termDiscountPct: number;
  /** Mensuel après remise d'engagement, avant code promo. */
  monthlyAfterTerm: number;
  /** Mensuel réellement facturé PENDANT la remise promo, après cascade engagement puis promo. */
  monthlyNet: number;
  /** Mensuel une fois la remise promo terminée (identique à monthlyNet si elle ne s'arrête pas). */
  monthlyAfterPromo: number;
  /** Mois de la 1re année couverts par la remise promo (0 = aucune, 12 = toute la période). */
  promoMonths: number;
  /** La remise promo s'arrête-t-elle avant la fin de la période ? */
  promoLimited: boolean;
  /** MRR = équivalent mensuel net (identique à monthlyNet, nommé explicitement). */
  mrr: number;
  /** Montant de la PROCHAINE facture, selon le rythme (mensuel ⇒ monthlyNet, annuel ⇒ 12 mois). */
  amountPerInvoice: number;
  /** Montant des factures suivantes, une fois la remise promo épuisée. */
  amountPerInvoiceAfterPromo: number;
  /** Total réellement payé sur les 12 premiers mois (remise limitée comprise). */
  firstYearTotal: number;
  /** Économie annuelle totale par rapport au tarif catalogue mensuel. */
  annualSavings: number;
  /** Nombre de mois d'engagement (12 pour l'annuel, 0 sinon). */
  commitmentMonths: number;
}

const MONTHS_PER_YEAR = 12;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Applique une remise promo à un montant. Ne descend jamais sous zéro. */
export function applyPromoDiscount(amount: number, promo?: PromoDiscount | null): number {
  if (!promo || amount <= 0) return Math.max(0, round2(amount));
  const reduced =
    promo.discountType === 'percent'
      ? amount * (1 - promo.discountValue / 100)
      : amount - promo.discountValue;
  return Math.max(0, round2(reduced));
}

/** Normalise le couple engagement / rythme : sans engagement ⇒ facturation mensuelle obligatoire. */
export function normaliseBilling(
  term: BillingTerm,
  interval: BillingInterval,
): { billingTerm: BillingTerm; billingInterval: BillingInterval } {
  const billingTerm: BillingTerm = term === 'annual' ? 'annual' : 'monthly';
  const billingInterval: BillingInterval =
    billingTerm === 'monthly' ? 'monthly' : interval === 'yearly' ? 'yearly' : 'monthly';
  return { billingTerm, billingInterval };
}

export function computePricing(input: PricingInput): PricingResult {
  const { billingTerm, billingInterval } = normaliseBilling(
    input.billingTerm,
    input.billingInterval,
  );

  const monthlyBase = round2(
    input.lines.reduce((sum, l) => sum + Number(l.seats) * Number(l.unitPrice), 0),
  );

  const rawPct = Number(input.annualDiscountPct);
  const pct = Number.isFinite(rawPct) ? Math.min(100, Math.max(0, rawPct)) : 0;
  const termDiscountPct = billingTerm === 'annual' ? pct : 0;

  const monthlyAfterTerm = round2(monthlyBase * (1 - termDiscountPct / 100));
  // Le code promo ne joue que s'il couvre la formule choisie (mensuel / annuel / les deux).
  const activePromo = promoAppliesToTerm(input.promo, billingTerm) ? input.promo : null;
  const monthlyNet = applyPromoDiscount(monthlyAfterTerm, activePromo);

  // Une remise peut ne couvrir que les premiers mois : le prix des factures suivantes remonte
  // alors au tarif d'après-remise. On chiffre donc séparément « pendant » et « après ».
  const promoMonths = promoMonthsCovered(activePromo);
  const promoLimited = promoMonths > 0 && promoMonths < MONTHS_PER_YEAR;
  const economiePromo = round2((monthlyAfterTerm - monthlyNet) * promoMonths);
  const firstYearTotal = round2(monthlyAfterTerm * MONTHS_PER_YEAR - economiePromo);

  return {
    monthlyBase,
    termDiscountPct,
    monthlyAfterTerm,
    monthlyNet,
    monthlyAfterPromo: promoLimited ? monthlyAfterTerm : monthlyNet,
    promoMonths,
    promoLimited,
    mrr: monthlyNet,
    amountPerInvoice: billingInterval === 'yearly' ? firstYearTotal : monthlyNet,
    amountPerInvoiceAfterPromo:
      billingInterval === 'yearly'
        ? round2(monthlyAfterTerm * MONTHS_PER_YEAR)
        : promoLimited ? monthlyAfterTerm : monthlyNet,
    firstYearTotal,
    annualSavings: round2(monthlyBase * MONTHS_PER_YEAR - firstYearTotal),
    commitmentMonths: billingTerm === 'annual' ? MONTHS_PER_YEAR : 0,
  };
}
