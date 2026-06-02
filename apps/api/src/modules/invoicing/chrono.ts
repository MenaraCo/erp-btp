/**
 * Invoice numbering "montage" (cahier des charges §5.6). A per-société pattern with tokens,
 * configured once: it is frozen after the first invoice is issued (enforced in the service).
 *
 * Tokens: {YYYY} {YY} {MM} {DD} and {SEQ} or {SEQ:n} (zero-padded sequence).
 * e.g. "FAC-{YYYY}-{SEQ:5}" with seq 1 -> "FAC-2026-00001".
 */
const SEQ_TOKEN = /\{SEQ(?::(\d+))?\}/;

export function patternHasSequence(pattern: string): boolean {
  return SEQ_TOKEN.test(pattern);
}

export function formatChrono(
  pattern: string,
  seq: number,
  date: Date = new Date(),
): string {
  const yyyy = date.getFullYear().toString();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return pattern
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yyyy.slice(-2))
    .replace(/\{MM\}/g, mm)
    .replace(/\{DD\}/g, dd)
    .replace(/\{SEQ:(\d+)\}/g, (_m, n: string) => String(seq).padStart(Number(n), '0'))
    .replace(/\{SEQ\}/g, String(seq));
}
