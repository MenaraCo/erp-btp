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

export type SectionKind = 'main' | 'option' | 'variante';

export interface VenteItemInput {
  id: string;
  debourseByNature?: Partial<Record<Nature, Decimal.Value>>;
  /**
   * Déboursé de sous-traitance ventilé par TYPE de ST (types définis par devis, ex. « moyens »,
   * « compétence »). Chaque type porte ses propres FG/bénéfice. Une ligne de ST sans type
   * reste dans debourseByNature.subcontract et suit les taux de la nature.
   */
  debourseBySt?: Partial<Record<string, Decimal.Value>>;
  vendable: boolean;
  /** explicit PV override (memorised, line-level "pv forcé") */
  forcedPv?: Decimal.Value | null;
  /** option/variante are priced but excluded from the contract total; default 'main' */
  section?: SectionKind;
}

export interface SaleCoefficients {
  byNature: Record<Nature, NatureSaleRate>;
  /** Taux propres à chaque TYPE de sous-traitance (clé = id du type, défini par devis). */
  stRates?: Record<string, NatureSaleRate>;
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
  section: SectionKind;
  appliedRates: Record<Nature, { fg: string; benefice: string }>;
  /** Déboursé de la ligne ventilé par nature (la sous-traitance agrège tous les types de ST). */
  debourseByNature: Record<Nature, string>;
  /** Déboursé ventilé par type de sous-traitance (vide si le devis n'en définit pas). */
  debourseBySt?: Record<string, string>;
  /** Taux appliqués à chaque type de ST, pour traçabilité. */
  appliedStRates?: Record<string, { fg: string; benefice: string }>;
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
  /** PV des options (hors total principal) */
  optionsPvHt: string;
  /** PV des variantes (hors total principal) */
  variantesPvHt: string;
  tva: string;
  totalTtc: string;
}

function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(PV_SCALE, Decimal.ROUND_HALF_UP);
}

function toBreakdown(input: Partial<Record<Nature, Decimal.Value>> | undefined): NatureBreakdown {
  const b = zeroBreakdown();
  for (const n of NATURES) {
    if (input?.[n] != null) {
      b[n] = new Decimal(input[n] as Decimal.Value);
    }
  }
  return b;
}

function sum(b: NatureBreakdown): Decimal {
  return NATURES.reduce((acc, n) => acc.plus(b[n]), new Decimal(0));
}

/**
 * Déboursé de sous-traitance par type. Un type absent du paramétrage du devis retombe sur les
 * taux de la nature « subcontract » : on ne perd jamais de déboursé (règle #3).
 */
type StBreakdown = Record<string, Decimal>;

function toStBreakdown(input: Partial<Record<string, Decimal.Value>> | undefined): StBreakdown {
  const b: StBreakdown = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v != null) {
      b[k] = new Decimal(v as Decimal.Value);
    }
  }
  return b;
}

function sumSt(b: StBreakdown): Decimal {
  return Object.values(b).reduce((acc, v) => acc.plus(v), new Decimal(0));
}

/** Taux applicables à un type de ST, avec repli sur la nature « sous-traitance ». */
function stRateOf(coeffs: SaleCoefficients, typeId: string): NatureSaleRate {
  return coeffs.stRates?.[typeId] ?? coeffs.byNature.subcontract ?? { tauxFg: 0, tauxBenefice: 0 };
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

/** Prices one item from its effective déboursé breakdown (ventilation already folded in). */
function priceItem(
  input: VenteItemInput,
  effBreakdown: NatureBreakdown,
  effSt: StBreakdown,
  ownDebourse: Decimal,
  coeffs: SaleCoefficients,
  section: SectionKind,
): VenteItemResult {
  let debourse = new Decimal(0);
  let revient = new Decimal(0);
  let pvComputed = new Decimal(0);
  const appliedRates = {} as Record<Nature, { fg: string; benefice: string }>;
  const appliedStRates: Record<string, { fg: string; benefice: string }> = {};

  const applyRate = (eff: Decimal, rate: NatureSaleRate) => {
    const fg = new Decimal(rate.tauxFg);
    const ben = new Decimal(rate.tauxBenefice);
    const revientN = eff.times(new Decimal(1).plus(fg.dividedBy(100)));
    const pvN = revientN.times(new Decimal(1).plus(ben.dividedBy(100)));
    debourse = debourse.plus(eff);
    revient = revient.plus(revientN);
    pvComputed = pvComputed.plus(pvN);
    return { fg: fg.toString(), benefice: ben.toString() };
  };

  for (const n of NATURES) {
    const rate = coeffs.byNature[n] ?? { tauxFg: 0, tauxBenefice: 0 };
    appliedRates[n] = applyRate(effBreakdown[n], rate);
  }
  // Chaque type de sous-traitance suit SES propres taux (repli sur la nature « subcontract »).
  for (const [typeId, eff] of Object.entries(effSt)) {
    appliedStRates[typeId] = applyRate(eff, stRateOf(coeffs, typeId));
  }

  const ventilatedFrais = debourse.minus(ownDebourse);
  pvComputed = round2(pvComputed);
  const forced = input.forcedPv != null;
  const pv = forced ? round2(new Decimal(input.forcedPv as Decimal.Value)) : pvComputed;

  const stTotal = sumSt(effSt);
  return {
    id: input.id,
    debourse: round2(debourse).toString(),
    ventilatedFrais: round2(ventilatedFrais).toString(),
    revient: round2(revient).toString(),
    pvComputed: pvComputed.toString(),
    pv: pv.toString(),
    forced,
    margeBrute: round2(pv.minus(debourse)).toString(),
    margeNette: round2(pv.minus(revient)).toString(),
    section,
    appliedRates,
    // La ligne « sous-traitance » agrège les types de ST : les consommateurs existants
    // (récap déboursé, synthèse par ouvrage) restent justes sans changement.
    debourseByNature: Object.fromEntries(
      NATURES.map((n) => [
        n,
        round2(n === 'subcontract' ? effBreakdown[n].plus(stTotal) : effBreakdown[n]).toString(),
      ]),
    ) as Record<Nature, string>,
    debourseBySt: Object.fromEntries(
      Object.entries(effSt).map(([k, v]) => [k, round2(v).toString()]),
    ),
    appliedStRates,
  };
}

export function computeFeuilleDeVente(
  items: VenteItemInput[],
  coeffs: SaleCoefficients,
): VenteResult {
  const tvaRate = new Decimal(coeffs.tvaRate);

  const prepared = items.map((it) => ({
    input: it,
    breakdown: toBreakdown(it.debourseByNature),
    st: toStBreakdown(it.debourseBySt),
    section: it.section ?? 'main',
  }));

  // Only "main" items count in the contract total and in frais ventilation.
  const main = prepared.filter((p) => p.section === 'main');
  const extras = prepared.filter((p) => p.section !== 'main');
  const vendable = main.filter((p) => p.input.vendable);

  // Per-nature frais totals from non-vendable MAIN items, ventilated pro rata over vendable déboursé.
  const fraisByNature = zeroBreakdown();
  const fraisBySt: StBreakdown = {};
  for (const p of main) {
    if (!p.input.vendable) {
      for (const n of NATURES) {
        fraisByNature[n] = fraisByNature[n].plus(p.breakdown[n]);
      }
      // Les frais de sous-traitance restent rattachés à LEUR type : la part ventilée sera
      // margée aux taux de ce type, pas à ceux de la nature générique.
      for (const [k, v] of Object.entries(p.st)) {
        fraisBySt[k] = (fraisBySt[k] ?? new Decimal(0)).plus(v);
      }
    }
  }
  const fraisTotal = sum(fraisByNature).plus(sumSt(fraisBySt));
  const vendableDebourseTotal = vendable.reduce(
    (acc, p) => acc.plus(sum(p.breakdown)).plus(sumSt(p.st)),
    new Decimal(0),
  );

  const results: VenteItemResult[] = [];
  let totalDebourse = new Decimal(0);
  let totalRevient = new Decimal(0);
  let pvHorsFrais = new Decimal(0);

  for (const p of vendable) {
    const ownDebourse = sum(p.breakdown).plus(sumSt(p.st));
    const share =
      vendableDebourseTotal.isZero() || fraisTotal.isZero()
        ? new Decimal(0)
        : ownDebourse.dividedBy(vendableDebourseTotal);
    const eff = zeroBreakdown();
    for (const n of NATURES) {
      eff[n] = p.breakdown[n].plus(fraisByNature[n].times(share));
    }
    const effSt: StBreakdown = { ...p.st };
    for (const [k, v] of Object.entries(fraisBySt)) {
      effSt[k] = (effSt[k] ?? new Decimal(0)).plus(v.times(share));
    }
    const r = priceItem(p.input, eff, effSt, ownDebourse, coeffs, 'main');
    results.push(r);
    totalDebourse = totalDebourse.plus(r.debourse);
    totalRevient = totalRevient.plus(r.revient);
    pvHorsFrais = pvHorsFrais.plus(r.pv);
  }

  // Options / variantes : priced standalone (no ventilation), excluded from the contract total.
  let optionsPvHt = new Decimal(0);
  let variantesPvHt = new Decimal(0);
  for (const p of extras) {
    const own = sum(p.breakdown).plus(sumSt(p.st));
    const r = priceItem(p.input, p.breakdown, p.st, own, coeffs, p.section);
    results.push(r);
    if (p.section === 'option') {
      optionsPvHt = optionsPvHt.plus(r.pv);
    } else {
      variantesPvHt = variantesPvHt.plus(r.pv);
    }
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
    optionsPvHt: round2(optionsPvHt).toString(),
    variantesPvHt: round2(variantesPvHt).toString(),
    tva: tva.toString(),
    totalTtc: round2(totalTtc).toString(),
  };
}
