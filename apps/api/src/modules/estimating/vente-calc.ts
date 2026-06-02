import Decimal from 'decimal.js';
import { Nature, NATURES, NatureBreakdown, zeroBreakdown } from './ouvrage-calc';

/**
 * Pure feuille de vente engine (cahier des charges §5.2, rules #2 and #3).
 *
 * Rule #2 — déboursé -> prix de vente: each nature's déboursé is multiplied by its sale
 * coefficient; the applied coefficients are returned for traceability. A forced PV is honoured
 * but flagged (forced=true) with the computed PV kept as reference.
 *
 * Rule #3 — ventilation: the déboursé of non-vendable items (titres / frais de chantier) is
 * spread over vendable items pro rata their déboursé, then sold at fraisCoefficient. Ventilation
 * conserves the total déboursé.
 */
export const PV_SCALE = 2;

export interface VenteItemInput {
  id: string;
  debourseByNature: Partial<Record<Nature, Decimal.Value>>;
  vendable: boolean;
  /** explicit PV override (memorised) */
  forcedPv?: Decimal.Value | null;
}

export interface SaleCoefficients {
  byNature: Record<Nature, Decimal.Value>;
  fraisCoefficient: Decimal.Value;
  tvaRate: Decimal.Value;
}

export interface VenteItemResult {
  id: string;
  debourse: string;
  ventilatedFrais: string;
  pvComputed: string;
  pv: string;
  forced: boolean;
  appliedCoefficients: Record<Nature, string>;
}

export interface VenteResult {
  items: VenteItemResult[];
  totalDebourse: string;
  totalPvHt: string;
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

export function computeFeuilleDeVente(
  items: VenteItemInput[],
  coeffs: SaleCoefficients,
): VenteResult {
  const fraisCoeff = new Decimal(coeffs.fraisCoefficient);
  const tvaRate = new Decimal(coeffs.tvaRate);

  const prepared = items.map((it) => ({
    input: it,
    breakdown: toBreakdown(it.debourseByNature),
  }));

  const vendable = prepared.filter((p) => p.input.vendable);
  const fraisTotal = prepared
    .filter((p) => !p.input.vendable)
    .reduce((acc, p) => acc.plus(sum(p.breakdown)), new Decimal(0));
  const vendableDebourseTotal = vendable.reduce((acc, p) => acc.plus(sum(p.breakdown)), new Decimal(0));

  const results: VenteItemResult[] = [];
  let totalDebourse = new Decimal(0);
  let totalPvHt = new Decimal(0);

  for (const p of vendable) {
    const debourse = sum(p.breakdown);
    const ventilated =
      vendableDebourseTotal.isZero() || fraisTotal.isZero()
        ? new Decimal(0)
        : fraisTotal.times(debourse).dividedBy(vendableDebourseTotal);

    let pvComputed = new Decimal(0);
    for (const n of NATURES) {
      pvComputed = pvComputed.plus(p.breakdown[n].times(new Decimal(coeffs.byNature[n])));
    }
    pvComputed = pvComputed.plus(ventilated.times(fraisCoeff));
    pvComputed = round2(pvComputed);

    const forced = p.input.forcedPv != null;
    const pv = forced ? round2(new Decimal(p.input.forcedPv as Decimal.Value)) : pvComputed;

    const appliedCoefficients = {} as Record<Nature, string>;
    for (const n of NATURES) {
      appliedCoefficients[n] = new Decimal(coeffs.byNature[n]).toString();
    }

    results.push({
      id: p.input.id,
      debourse: debourse.toString(),
      ventilatedFrais: round2(ventilated).toString(),
      pvComputed: pvComputed.toString(),
      pv: pv.toString(),
      forced,
      appliedCoefficients,
    });
    totalDebourse = totalDebourse.plus(debourse);
    totalPvHt = totalPvHt.plus(pv);
  }

  totalDebourse = totalDebourse.plus(fraisTotal);
  const tva = round2(totalPvHt.times(tvaRate));
  const totalTtc = totalPvHt.plus(tva);

  return {
    items: results,
    totalDebourse: totalDebourse.toString(),
    totalPvHt: totalPvHt.toString(),
    tva: tva.toString(),
    totalTtc: totalTtc.toString(),
  };
}
