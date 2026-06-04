import Decimal from 'decimal.js';
import { Nature, NATURES, NatureBreakdown, zeroBreakdown } from './ouvrage-calc';

/**
 * Pure feuille de vente engine (cahier des charges §5.2, rules #2 and #3).
 *
 * Cascade (per nature, then aggregated):
 *   déboursé_nature → ×(1 + FG%)       = prix de revient_nature
 *                   → ×(1 + Bénéfice%) = prix de vente_nature
 * FG (frais généraux) and Bénéfice are configured separately per nature, so the prix de revient
 * is a distinct, traceable intermediate — this is what makes marge brute (PV − déboursé) and
 * marge nette (PV − prix de revient) two different KPIs.
 *
 * Rule #2 — déboursé → prix de vente: each nature's déboursé runs the cascade; the applied
 * FG/Bénéfice are returned for traceability. A forced PV is honoured but flagged (forced=true)
 * with the computed PV kept as reference.
 *
 * Rule #3 — ventilation: the déboursé of non-vendable items (titres / frais de chantier) is
 * spread over vendable items pro rata their déboursé. The ventilated amount keeps its nature, so
 * it runs the same per-nature cascade. Ventilation conserves the total déboursé.
 *
 * On top of the lines: frais annexes (named list, % of PV hors frais or fixed amount) are added,
 * then a global remise (% or fixed) is subtracted, then TVA is applied.
 */
export const PV_SCALE = 2;
const COEFF_SCALE = 4;

export type FraisType = 'pct' | 'fixe';

export interface NatureSaleRate {
  /** frais généraux, as a percentage (e.g. '10' = 10%) */
  tauxFg: Decimal.Value;
  /** bénéfice, as a percentage (e.g. '15' = 15%) */
  tauxBenefice: Decimal.Value;
}

export interface FraisAnnexe {
  designation: string;
  type: FraisType;
  /** pct: percentage of PV hors frais (e.g. '2' = 2%); fixe: absolute amount */
  valeur: Decimal.Value;
}

export interface Remise {
  type: FraisType;
  /** pct: percentage of PV devis (e.g. '5' = 5%); fixe: absolute amount */
  valeur: Decimal.Value;
}

export interface VenteItemInput {
  id: string;
  debourseByNature: Partial<Record<Nature, Decimal.Value>>;
  vendable: boolean;
  /** explicit PV override (memorised, line-level "pv forcé") */
  forcedPv?: Decimal.Value | null;
}

export interface SaleCoefficients {
  byNature: Record<Nature, NatureSaleRate>;
  fraisAnnexes?: FraisAnnexe[];
  remise?: Remise | null;
  tvaRate: Decimal.Value;
}

export interface VenteItemResult {
  id: string;
  /** déboursé of the line, ventilated frais included */
  debourse: string;
  ventilatedFrais: string;
  /** déboursé × (1 + FG) per nature, aggregated */
  revient: string;
  pvComputed: string;
  pv: string;
  forced: boolean;
  margeBrute: string;
  margeNette: string;
  appliedRates: Record<Nature, { fg: string; benefice: string }>;
}

export interface VenteResult {
  items: VenteItemResult[];
  totalDebourse: string;
  totalRevient: string;
  /** Σ des PV de ligne (forcés ou calculés), avant frais annexes & remise */
  pvHorsFrais: string;
  fraisAnnexes: string;
  pvDevis: string;
  remise: string;
  /** PV net = pvDevis − remise ; base de la TVA (nom conservé pour compat) */
  totalPvHt: string;
  margeBrute: string;
  margeNette: string;
  coeffGlobalReel: string;
  tva: string;
  totalTtc: string;
}

function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(PV_SCALE, Decimal.ROUND_HALF_UP);
}

function toBreakdown(input: Partial<Record<Nature, Decimal.Value>>): NatureBreakdown {
  const b = zeroBreakdown();
  for (const n of NATURES) {
    if (input[n] != null) {
      b[n] = new Decimal(input[n] as Decimal.Value);
    }
  }
  return b;
}

function sum(b: NatureBreakdown): Decimal {
  return NATURES.reduce((acc, n) => acc.plus(b[n]), new Decimal(0));
}

/** Frais annexes amount: pct items apply to the PV hors frais, fixe items are added as-is. */
function computeFraisAnnexes(frais: FraisAnnexe[], pvHorsFrais: Decimal): Decimal {
  return frais.reduce((acc, f) => {
    const v = new Decimal(f.valeur);
    return acc.plus(f.type === 'pct' ? pvHorsFrais.times(v).dividedBy(100) : v);
  }, new Decimal(0));
}

/** Remise amount: pct applies to the PV devis, fixe is the amount itself. */
function computeRemise(remise: Remise | null | undefined, pvDevis: Decimal): Decimal {
  if (!remise) {
    return new Decimal(0);
  }
  const v = new Decimal(remise.valeur);
  return remise.type === 'pct' ? pvDevis.times(v).dividedBy(100) : v;
}

export function computeFeuilleDeVente(
  items: VenteItemInput[],
  coeffs: SaleCoefficients,
): VenteResult {
  const tvaRate = new Decimal(coeffs.tvaRate);

  const prepared = items.map((it) => ({
    input: it,
    breakdown: toBreakdown(it.debourseByNature),
  }));

  const vendable = prepared.filter((p) => p.input.vendable);

  // Per-nature frais totals from non-vendable items, ventilated pro rata over vendable déboursé.
  const fraisByNature = zeroBreakdown();
  for (const p of prepared) {
    if (!p.input.vendable) {
      for (const n of NATURES) {
        fraisByNature[n] = fraisByNature[n].plus(p.breakdown[n]);
      }
    }
  }
  const fraisTotal = sum(fraisByNature);
  const vendableDebourseTotal = vendable.reduce(
    (acc, p) => acc.plus(sum(p.breakdown)),
    new Decimal(0),
  );

  const results: VenteItemResult[] = [];
  let totalDebourse = new Decimal(0);
  let totalRevient = new Decimal(0);
  let pvHorsFrais = new Decimal(0);

  for (const p of vendable) {
    const ownDebourse = sum(p.breakdown);
    const share =
      vendableDebourseTotal.isZero() || fraisTotal.isZero()
        ? new Decimal(0)
        : ownDebourse.dividedBy(vendableDebourseTotal);

    let debourse = new Decimal(0);
    let revient = new Decimal(0);
    let pvComputed = new Decimal(0);
    const appliedRates = {} as Record<Nature, { fg: string; benefice: string }>;

    for (const n of NATURES) {
      const rate = coeffs.byNature[n] ?? { tauxFg: 0, tauxBenefice: 0 };
      const fg = new Decimal(rate.tauxFg);
      const ben = new Decimal(rate.tauxBenefice);
      appliedRates[n] = { fg: fg.toString(), benefice: ben.toString() };

      // own déboursé of this nature + its ventilated share of the frais of the same nature
      const eff = p.breakdown[n].plus(fraisByNature[n].times(share));
      const revientN = eff.times(new Decimal(1).plus(fg.dividedBy(100)));
      const pvN = revientN.times(new Decimal(1).plus(ben.dividedBy(100)));
      debourse = debourse.plus(eff);
      revient = revient.plus(revientN);
      pvComputed = pvComputed.plus(pvN);
    }

    const ventilatedFrais = debourse.minus(ownDebourse);
    pvComputed = round2(pvComputed);
    const forced = p.input.forcedPv != null;
    const pv = forced ? round2(new Decimal(p.input.forcedPv as Decimal.Value)) : pvComputed;

    results.push({
      id: p.input.id,
      debourse: round2(debourse).toString(),
      ventilatedFrais: round2(ventilatedFrais).toString(),
      revient: round2(revient).toString(),
      pvComputed: pvComputed.toString(),
      pv: pv.toString(),
      forced,
      margeBrute: round2(pv.minus(debourse)).toString(),
      margeNette: round2(pv.minus(revient)).toString(),
      appliedRates,
    });

    totalDebourse = totalDebourse.plus(debourse);
    totalRevient = totalRevient.plus(revient);
    pvHorsFrais = pvHorsFrais.plus(pv);
  }

  pvHorsFrais = round2(pvHorsFrais);
  const fraisAnnexesMt = round2(computeFraisAnnexes(coeffs.fraisAnnexes ?? [], pvHorsFrais));
  const pvDevis = pvHorsFrais.plus(fraisAnnexesMt);
  const remiseMt = round2(computeRemise(coeffs.remise, pvDevis));
  const pvNet = pvDevis.minus(remiseMt);

  const tva = round2(pvNet.times(tvaRate));
  const totalTtc = pvNet.plus(tva);
  const coeffGlobalReel = totalDebourse.isZero()
    ? new Decimal(0)
    : pvHorsFrais.dividedBy(totalDebourse).toDecimalPlaces(COEFF_SCALE, Decimal.ROUND_HALF_UP);

  return {
    items: results,
    totalDebourse: round2(totalDebourse).toString(),
    totalRevient: round2(totalRevient).toString(),
    pvHorsFrais: pvHorsFrais.toString(),
    fraisAnnexes: fraisAnnexesMt.toString(),
    pvDevis: round2(pvDevis).toString(),
    remise: remiseMt.toString(),
    totalPvHt: round2(pvNet).toString(),
    margeBrute: round2(pvNet.minus(totalDebourse)).toString(),
    margeNette: round2(pvNet.minus(totalRevient)).toString(),
    coeffGlobalReel: coeffGlobalReel.toString(),
    tva: tva.toString(),
    totalTtc: round2(totalTtc).toString(),
  };
}
