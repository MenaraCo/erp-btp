import Decimal from 'decimal.js';
import { BudgetNature } from './budget-nature';

/**
 * Pure analytics for chantier results (cahier des charges §5.5). Raw synthesis by nature:
 * budget vs engagé vs réalisé, and the écart = budget objectif − (réalisé + engagé).
 * (The predictive indicators — budget avancé, EAC, marge prévisionnelle — live in the
 * versioned financial-management engine, Part B.)
 */
export interface NatureResultInput {
  nature: BudgetNature;
  budgetObjectif: Decimal.Value;
  budgetPrevisionnel: Decimal.Value;
  engage: Decimal.Value;
  realise: Decimal.Value;
}

export interface NatureResult {
  nature: BudgetNature;
  budgetObjectif: string;
  budgetPrevisionnel: string;
  engage: string;
  realise: string;
  /** budget objectif − (réalisé + engagé) ; négatif = dérive */
  ecart: string;
}

function r2(v: Decimal): Decimal {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function natureResult(input: NatureResultInput): NatureResult {
  const budgetObjectif = new Decimal(input.budgetObjectif);
  const engage = new Decimal(input.engage);
  const realise = new Decimal(input.realise);
  const ecart = budgetObjectif.minus(realise.plus(engage));
  return {
    nature: input.nature,
    budgetObjectif: r2(budgetObjectif).toFixed(2),
    budgetPrevisionnel: r2(new Decimal(input.budgetPrevisionnel)).toFixed(2),
    engage: r2(engage).toFixed(2),
    realise: r2(realise).toFixed(2),
    ecart: r2(ecart).toFixed(2),
  };
}
