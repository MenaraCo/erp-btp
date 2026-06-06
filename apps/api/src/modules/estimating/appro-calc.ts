import Decimal from 'decimal.js';

/**
 * Calcul d'approvisionnement d'une ressource (inspiré de CHIFFRAGE) : on convertit la quantité
 * d'EMPLOI (consommée sur le chantier) en quantité d'ACHAT via le coefficient de conversion
 * (1 unité d'achat = coeff unités d'emploi). Le montant est valorisé au prix catalogue (par unité
 * d'achat) si renseigné, sinon au déboursé unitaire (par unité d'emploi). Decimal uniquement.
 */
export interface ApproInput {
  qteEmploi: Decimal.Value;
  /** 1 unité d'achat = coeff unités d'emploi */
  coeffConversion: Decimal.Value;
  /** prix catalogue par unité d'achat (optionnel) */
  prixPublic?: Decimal.Value | null;
  /** déboursé unitaire par unité d'emploi */
  puDebours: Decimal.Value;
}

export interface ApproResult {
  /** quantité à approvisionner, en unité d'achat */
  qteAppro: string;
  /** montant HT */
  montant: string;
}

export function computeApproLine(input: ApproInput): ApproResult {
  const qteEmploi = new Decimal(input.qteEmploi);
  const coeff = new Decimal(input.coeffConversion || 0);
  const qteAppro = coeff.greaterThan(0) ? qteEmploi.dividedBy(coeff) : qteEmploi;
  const prix = input.prixPublic != null ? new Decimal(input.prixPublic) : new Decimal(0);
  const montant = prix.greaterThan(0)
    ? qteAppro.times(prix)
    : qteEmploi.times(new Decimal(input.puDebours || 0));
  return {
    qteAppro: qteAppro.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toString(),
    montant: montant.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
  };
}
