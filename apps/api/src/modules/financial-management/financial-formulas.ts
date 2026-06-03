import Decimal from 'decimal.js';

/**
 * Pure predictive cost-control engine (cahier des charges §5.8, rule #9). Computes, in real time,
 * the indicators answering "what will the chantier's real margin be at completion?". The algorithms
 * are fixed and unit-tested; the tunable parameters (EAC method, alert thresholds, marge cible)
 * come from the versioned per-tenant formula set (B.1) and are passed in as inputs.
 *
 * Money rounded to 2 decimals, ratios to 4. Division-by-zero guarded → null.
 */
export interface FormulaInputs {
  /** Vente totale (marché + avenants, ou budget de vente du chantier). */
  vente: Decimal.Value;
  /** Budget objectif = "budget initial" de contrôle (contre-étude validée). */
  budget: Decimal.Value;
  /** Budget prévisionnel révisé en cours d'exécution. */
  previsionnel: Decimal.Value;
  /** Engagé (commandes validées). */
  engage: Decimal.Value;
  /** Réalisé (factures fournisseurs + pointages). */
  realise: Decimal.Value;
  /** Avancement physique, fraction 0..1. */
  avancement: Decimal.Value;
  eacMethod: 'm1' | 'm2';
  /** Seuil d'alerte d'écart (fraction, ex. -0.05). */
  ecartAlertPct: Decimal.Value;
  /** Marge cible (fraction, ex. 0.05). */
  margeCiblePct: Decimal.Value;
}

export type AlertCode = 'ecart' | 'marge';

export interface Indicators {
  budgetAvance: string;
  ecartAuStade: string;
  resteAEngager: string;
  resteADepenser: string;
  /** Cost Performance Index = budget avancé / réalisé (null si réalisé = 0). */
  cpi: string | null;
  /** Estimate At Completion (null si indéterminé). */
  eac: string | null;
  margePrevisionnelle: string | null;
  margePrevisionnellePct: string | null;
  alerts: AlertCode[];
}

const money = (d: Decimal) => d.toDecimalPlaces(2).toFixed(2);
const ratio = (d: Decimal) => d.toDecimalPlaces(4).toFixed(4);

export function computeIndicators(input: FormulaInputs): Indicators {
  const vente = new Decimal(input.vente);
  const budget = new Decimal(input.budget);
  const previsionnel = new Decimal(input.previsionnel);
  const engage = new Decimal(input.engage);
  const realise = new Decimal(input.realise);
  const avancement = new Decimal(input.avancement);

  const budgetAvance = budget.times(avancement);
  const ecartAuStade = budgetAvance.minus(realise.plus(engage));
  const resteAEngager = budget.minus(engage);
  const resteADepenser = previsionnel.minus(realise);

  // CPI = budget avancé / réalisé ; indéfini si réalisé = 0.
  const cpi = realise.isZero() ? null : budgetAvance.dividedBy(realise);

  // EAC : m1 = réalisé + reste à dépenser (suit le prévisionnel) ; m2 = budget / CPI.
  let eac: Decimal | null;
  if (input.eacMethod === 'm1') {
    eac = realise.plus(resteADepenser);
  } else {
    eac = cpi && !cpi.isZero() ? budget.dividedBy(cpi) : null;
  }

  const margePrevisionnelle = eac ? vente.minus(eac) : null;
  const margePrevisionnellePct =
    margePrevisionnelle && !vente.isZero() ? margePrevisionnelle.dividedBy(vente) : null;

  const alerts: AlertCode[] = [];
  if (!budget.isZero() && ecartAuStade.dividedBy(budget).lessThan(new Decimal(input.ecartAlertPct))) {
    alerts.push('ecart');
  }
  if (margePrevisionnellePct && margePrevisionnellePct.lessThan(new Decimal(input.margeCiblePct))) {
    alerts.push('marge');
  }

  return {
    budgetAvance: money(budgetAvance),
    ecartAuStade: money(ecartAuStade),
    resteAEngager: money(resteAEngager),
    resteADepenser: money(resteADepenser),
    cpi: cpi ? ratio(cpi) : null,
    eac: eac ? money(eac) : null,
    margePrevisionnelle: margePrevisionnelle ? money(margePrevisionnelle) : null,
    margePrevisionnellePct: margePrevisionnellePct ? ratio(margePrevisionnellePct) : null,
    alerts,
  };
}
