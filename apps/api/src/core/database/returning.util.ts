/**
 * Normalises the result of a `... RETURNING` query run through TypeORM's `query()`.
 *
 * TypeORM inspects the driver's command tag: for **UPDATE** and **DELETE** it sets the raw result
 * to `[rows, affectedCount]`, whereas for **SELECT** and **INSERT** (including
 * `INSERT ... ON CONFLICT DO UPDATE`) it returns the plain rows array.
 *
 * Treating an `UPDATE ... RETURNING` result as a rows array is therefore silently wrong:
 * `result.length` is always 2 (so "not found" guards never fire) and `result[0]` is the rows
 * array rather than the first row (so mapped fields come back `undefined`).
 *
 * Wrap UPDATE/DELETE `RETURNING` calls with this helper to always get the rows.
 */
export function returningRows<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return (Array.isArray(result) ? result : []) as T[];
}
