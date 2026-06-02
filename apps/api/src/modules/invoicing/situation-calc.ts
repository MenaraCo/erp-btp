import Decimal from 'decimal.js';

/**
 * Pure situation-de-travaux engine (cahier des charges §5.6, critical rule #6).
 *
 *   montant cumulé HT  = Σ(quantité marché × PU × % avancement)  × coefficient de révision
 *   montant période HT = cumulé HT − situations antérieures (cumul précédent)
 *   retenue de garantie = taux × montant période HT
 *   pied : TVA, TTC, et NAP (net à payer) = TTC − retenue de garantie
 *
 * Decimal arithmetic only; amounts rounded to 2 decimals.
 */
export const MONEY_SCALE = 2;

export interface SituationLineInput {
  marcheLineId: string;
  quantite: Decimal.Value;
  pu: Decimal.Value;
  /** cumulative advancement as a fraction (0.5 = 50%) */
  pctAvancement: Decimal.Value;
}

export interface SituationParams {
  /** revised cumulative HT certified by the previous situation (0 for the first) */
  previousCumulHt: Decimal.Value;
  retenueRate: Decimal.Value;
  revisionCoefficient: Decimal.Value;
  tvaRate: Decimal.Value;
}

export interface SituationLineResult {
  marcheLineId: string;
  cumulHt: string;
}

export interface SituationResult {
  lines: SituationLineResult[];
  cumulHt: string;
  montantPeriodeHt: string;
  tva: string;
  ttc: string;
  retenueGarantie: string;
  nap: string;
}

function round2(v: Decimal): Decimal {
  return v.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

export function computeSituation(
  lines: SituationLineInput[],
  params: SituationParams,
): SituationResult {
  const revision = new Decimal(params.revisionCoefficient);

  let cumulBrut = new Decimal(0);
  const lineResults: SituationLineResult[] = [];
  for (const l of lines) {
    const lineCumul = new Decimal(l.quantite)
      .times(new Decimal(l.pu))
      .times(new Decimal(l.pctAvancement));
    cumulBrut = cumulBrut.plus(lineCumul);
    lineResults.push({
      marcheLineId: l.marcheLineId,
      cumulHt: round2(lineCumul.times(revision)).toString(),
    });
  }

  const cumulHt = round2(cumulBrut.times(revision));
  const montantPeriodeHt = round2(cumulHt.minus(new Decimal(params.previousCumulHt)));
  const tva = round2(montantPeriodeHt.times(new Decimal(params.tvaRate)));
  const ttc = round2(montantPeriodeHt.plus(tva));
  const retenueGarantie = round2(montantPeriodeHt.times(new Decimal(params.retenueRate)));
  const nap = round2(ttc.minus(retenueGarantie));

  return {
    lines: lineResults,
    cumulHt: cumulHt.toString(),
    montantPeriodeHt: montantPeriodeHt.toString(),
    tva: tva.toString(),
    ttc: ttc.toString(),
    retenueGarantie: retenueGarantie.toString(),
    nap: nap.toString(),
  };
}
