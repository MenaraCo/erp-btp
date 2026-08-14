import { Parser } from 'expr-eval';
import Decimal from 'decimal.js';

/**
 * Safe métré formula evaluator (cahier des charges §5.2). Uses expr-eval (no JS eval) to compute
 * a quantity from a formula and named global variables (e.g. "longueur * largeur"). The result
 * is rounded to QTY_SCALE decimals. Quantities use plain numbers for the formula arithmetic,
 * then Decimal for storage rounding.
 */
export const QTY_SCALE = 4;

/**
 * Évaluateur RESTREINT à l'arithmétique pure (ex. « longueur * largeur + 2 »).
 *
 * expr-eval n'a pas de version corrigée publiée (dernière = 2.0.2), et ses failles connues
 * (pollution de prototype, appels de fonctions non restreints) passent par l'AFFECTATION, les
 * DÉFINITIONS DE FONCTION et l'accès membre. On les désactive : un métré n'a besoin que des quatre
 * opérations, de la puissance et du modulo. La surface exploitable disparaît, et la validation des
 * variables plus bas rejette déjà tout nom non fourni explicitement.
 */
const parser = new Parser({
  operators: {
    add: true, subtract: true, multiply: true, divide: true, power: true, remainder: true,
    // Tout le reste coupé — notamment l'affectation et les définitions de fonction, vecteurs
    // des CVE expr-eval (pollution de prototype / appels de fonctions non restreints).
    assignment: false, fndef: false,
    conditional: false, logical: false, comparison: false, in: false,
    factorial: false, concatenate: false,
  },
});

export class UnknownVariableError extends Error {
  constructor(public readonly name: string) {
    super(`Unknown métré variable "${name}"`);
    this.name = 'UnknownVariableError';
  }
}

export class InvalidFormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFormulaError';
  }
}

export function evaluateMetre(
  formula: string,
  variables: Record<string, number>,
): Decimal {
  let expr;
  try {
    expr = parser.parse(formula);
  } catch (e) {
    throw new InvalidFormulaError(`Cannot parse formula: ${(e as Error).message}`);
  }

  for (const name of expr.variables()) {
    if (!(name in variables)) {
      throw new UnknownVariableError(name);
    }
  }

  const result = expr.evaluate(variables);
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new InvalidFormulaError('Formula did not evaluate to a finite number');
  }
  return new Decimal(result).toDecimalPlaces(QTY_SCALE, Decimal.ROUND_HALF_UP);
}
