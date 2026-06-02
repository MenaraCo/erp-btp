import Decimal from 'decimal.js';

/**
 * Pure DGD (Décompte Général Définitif) engine (cahier des charges §5.6). Closes the marché from
 * the last situation: certified cumulative work (marché + avenants), VAT, total guarantee
 * retention withheld over all situations, and the remaining balance (solde) net to pay.
 */
export interface DgdInput {
  montantMarcheHt: Decimal.Value;
  /** cumulative certified work HT (last situation's cumul) */
  travauxCumulHt: Decimal.Value;
  tvaRate: Decimal.Value;
  /** total guarantee retention withheld across all situations */
  retenueGarantieTotale: Decimal.Value;
  /** total already paid (sum of situations' NAP) */
  dejaRegleNap: Decimal.Value;
}

export interface DgdResult {
  montantMarcheHt: string;
  travauxCumulHt: string;
  tva: string;
  ttc: string;
  retenueGarantieTotale: string;
  dejaRegleNap: string;
  soldeNap: string;
}

function round2(v: Decimal): Decimal {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function computeDgd(input: DgdInput): DgdResult {
  const travaux = round2(new Decimal(input.travauxCumulHt));
  const tva = round2(travaux.times(new Decimal(input.tvaRate)));
  const ttc = round2(travaux.plus(tva));
  const dejaRegle = round2(new Decimal(input.dejaRegleNap));
  const soldeNap = round2(ttc.minus(dejaRegle));

  return {
    montantMarcheHt: round2(new Decimal(input.montantMarcheHt)).toString(),
    travauxCumulHt: travaux.toString(),
    tva: tva.toString(),
    ttc: ttc.toString(),
    retenueGarantieTotale: round2(new Decimal(input.retenueGarantieTotale)).toString(),
    dejaRegleNap: dejaRegle.toString(),
    soldeNap: soldeNap.toString(),
  };
}
