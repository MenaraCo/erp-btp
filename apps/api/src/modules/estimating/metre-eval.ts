import { Parser } from 'expr-eval';
import Decimal from 'decimal.js';

/**
 * Safe métré formula evaluator (cahier des charges §5.2). Uses expr-eval (no JS eval) to compute
 * a quantity from a formula and named global variables (e.g. "longueur * largeur"). The result
 * is rounded to QTY_SCALE decimals. Quantities use plain numbers for the formula arithmetic,
 * then Decimal for storage rounding.
 */
export const QTY_SCALE = 4;

const parser = new Parser();

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
