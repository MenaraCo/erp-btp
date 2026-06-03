import Decimal from 'decimal.js';
import {
  CalcOuvrage,
  CycleDetectedError,
  UnknownOuvrageError,
} from './ouvrage-calc';

/**
 * Generic ascending breakdown of the déboursé sec keyed by an arbitrary bucket, mirroring
 * computeNatureBreakdownMap but with dynamic keys instead of the fixed 4 natures. Used to break
 * the chantier déboursé down by analytical famille (cahier des charges §5.8) so the analytical
 * axis can compare budget at every level. Percentage components allocate pro rata across the
 * buckets of their assiette, so the per-bucket sum always equals the total déboursé.
 */

export type BucketBreakdown = Record<string, Decimal>;

/** Bucket key for resources that carry no analytical famille (unclassified / no source). */
export const UNALLOCATED_BUCKET = '__unallocated__';

export function computeBucketBreakdownMap(
  ouvragesById: Map<string, CalcOuvrage>,
): Map<string, BucketBreakdown> {
  const memo = new Map<string, BucketBreakdown>();
  const visiting = new Set<string>();

  function add(target: BucketBreakdown, key: string, value: Decimal): void {
    target[key] = (target[key] ?? new Decimal(0)).plus(value);
  }

  function visit(id: string): BucketBreakdown {
    const cached = memo.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw new CycleDetectedError(id);
    const ouvrage = ouvragesById.get(id);
    if (!ouvrage) throw new UnknownOuvrageError(id);
    visiting.add(id);

    const base: BucketBreakdown = {};
    for (const c of ouvrage.components) {
      if (c.kind === 'resource') {
        const key = c.bucket ?? UNALLOCATED_BUCKET;
        add(base, key, new Decimal(c.quantity ?? 0).times(new Decimal(c.unitCost ?? 0)));
      } else if (c.kind === 'sub_ouvrage') {
        if (!c.childOuvrageId) {
          throw new Error(`sub_ouvrage component without childOuvrageId in "${id}"`);
        }
        const qty = new Decimal(c.quantity ?? 0);
        const child = visit(c.childOuvrageId);
        for (const [key, value] of Object.entries(child)) {
          add(base, key, qty.times(value));
        }
      }
    }

    // Percentages allocate pro rata across the assiette's buckets.
    let rateTotal = new Decimal(0);
    for (const c of ouvrage.components) {
      if (c.kind === 'percentage') rateTotal = rateTotal.plus(new Decimal(c.rate ?? 0));
    }
    const result: BucketBreakdown = {};
    for (const [key, value] of Object.entries(base)) {
      result[key] = value.plus(value.times(rateTotal));
    }

    visiting.delete(id);
    memo.set(id, result);
    return result;
  }

  for (const id of ouvragesById.keys()) visit(id);
  return memo;
}
