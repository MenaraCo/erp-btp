/**
 * Recodification of avenant lines (cahier des charges §5.4, rule #4).
 *
 * By default an avenant line is recodified with a suffix `-AV<numero>` so the initial market
 * prices/codes stay frozen and codes never collide when the same resource has a different price
 * in the avenant.
 */
export function recodifyForAvenant(
  baseCode: string | null | undefined,
  numero: number,
): string {
  const suffix = `-AV${numero}`;
  return baseCode ? `${baseCode}${suffix}` : `AV${numero}`;
}
