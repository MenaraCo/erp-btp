/** Formats a numeric string/number as EUR with French grouping. Returns '—' for null/NaN. */
export function euro(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

/** Formats a fraction (0.18) as a percentage string ('18,0 %'). */
export function percent(fraction: string | number | null | undefined): string {
  if (fraction === null || fraction === undefined || fraction === '') return '—';
  const n = typeof fraction === 'number' ? fraction : Number(fraction);
  if (Number.isNaN(n)) return '—';
  return `${(n * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

export const AFFAIRE_STATUS_LABELS: Record<string, string> = {
  open: 'En cours',
  sent: 'Envoyé',
  won: 'Gagné',
  lost: 'Perdu',
  followup: 'Relancé',
  revision: 'Révision',
};
