import Decimal from 'decimal.js';

/**
 * Pure, database-free engine for the déboursé sec of composed ouvrages (cahier des charges
 * §5.1, critical rule #1). Decimal arithmetic only — never floats.
 *
 * An ouvrage is a list of components:
 *  - resource    : quantity × unitCost
 *  - sub_ouvrage : quantity × déboursé(child)            (recursive)
 *  - percentage  : rate × base, where base = Σ of the non-percentage components of the ouvrage
 *                  (no percentage-on-percentage; percentages apply after direct components)
 *
 * The ouvrage graph must be a DAG; cycles raise CycleDetectedError.
 */

export type ComponentKind = 'resource' | 'sub_ouvrage' | 'percentage';

export interface CalcComponent {
  kind: ComponentKind;
  /** resource & sub_ouvrage */
  quantity?: Decimal.Value;
  /** resource: resolved déboursé unitaire */
  unitCost?: Decimal.Value;
  /** sub_ouvrage: referenced child ouvrage id */
  childOuvrageId?: string;
  /** percentage: rate as a fraction (e.g. 0.03 for 3%) */
  rate?: Decimal.Value;
}

export interface CalcOuvrage {
  id: string;
  components: CalcComponent[];
}

export class CycleDetectedError extends Error {
  constructor(public readonly ouvrageId: string) {
    super(`Cycle detected in ouvrage composition at "${ouvrageId}"`);
    this.name = 'CycleDetectedError';
  }
}

export class UnknownOuvrageError extends Error {
  constructor(public readonly ouvrageId: string) {
    super(`Unknown ouvrage "${ouvrageId}"`);
    this.name = 'UnknownOuvrageError';
  }
}

/** Number of decimal places kept when persisting a déboursé (matches NUMERIC(14,4)). */
export const DEBOURSE_SCALE = 4;

export function roundDebourse(value: Decimal): Decimal {
  return value.toDecimalPlaces(DEBOURSE_SCALE, Decimal.ROUND_HALF_UP);
}

/**
 * Computes the déboursé sec of every ouvrage in the map, in a single memoized pass.
 * Returns full-precision Decimals (round at persistence with roundDebourse).
 */
export function computeDebourseMap(
  ouvragesById: Map<string, CalcOuvrage>,
): Map<string, Decimal> {
  const memo = new Map<string, Decimal>();
  const visiting = new Set<string>();

  function visit(id: string): Decimal {
    const cached = memo.get(id);
    if (cached) {
      return cached;
    }
    if (visiting.has(id)) {
      throw new CycleDetectedError(id);
    }
    const ouvrage = ouvragesById.get(id);
    if (!ouvrage) {
      throw new UnknownOuvrageError(id);
    }
    visiting.add(id);

    let base = new Decimal(0);
    for (const c of ouvrage.components) {
      if (c.kind === 'resource') {
        base = base.plus(new Decimal(c.quantity ?? 0).times(new Decimal(c.unitCost ?? 0)));
      } else if (c.kind === 'sub_ouvrage') {
        if (!c.childOuvrageId) {
          throw new Error(`sub_ouvrage component without childOuvrageId in "${id}"`);
        }
        base = base.plus(new Decimal(c.quantity ?? 0).times(visit(c.childOuvrageId)));
      }
    }

    let percentage = new Decimal(0);
    for (const c of ouvrage.components) {
      if (c.kind === 'percentage') {
        percentage = percentage.plus(new Decimal(c.rate ?? 0).times(base));
      }
    }

    const total = base.plus(percentage);
    visiting.delete(id);
    memo.set(id, total);
    return total;
  }

  for (const id of ouvragesById.keys()) {
    visit(id);
  }
  return memo;
}

/** Convenience: déboursé of a single ouvrage within its map. */
export function computeDebourse(
  rootId: string,
  ouvragesById: Map<string, CalcOuvrage>,
): Decimal {
  return computeDebourseMap(ouvragesById).get(rootId) ?? new Decimal(0);
}
