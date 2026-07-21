/**
 * French VAT rules (versioned, isolated). Includes the BTP subcontracting autoliquidation case
 * (VAT 0 with a legal mention). Update here when the law changes — never inline in services.
 */
export interface VatRate {
  code: string;
  label: string;
  percent: number;
}

export const VAT_RATES_FR: VatRate[] = [
  { code: 'standard', label: 'Taux normal', percent: 20 },
  { code: 'intermediate', label: 'Taux intermédiaire', percent: 10 },
  { code: 'reduced', label: 'Taux réduit', percent: 5.5 },
  { code: 'particular', label: 'Taux particulier', percent: 2.1 },
  { code: 'autoliquidation', label: 'Autoliquidation sous-traitance BTP', percent: 0 },
];

/** Legal mention required on subcontracting invoices under the reverse-charge regime. */
export const AUTOLIQUIDATION_MENTION =
  'Autoliquidation — article 283-2 nonies du CGI';

export function vatRateByCode(code: string): VatRate | undefined {
  return VAT_RATES_FR.find((r) => r.code === code);
}

export function isValidVatPercent(percent: number): boolean {
  return VAT_RATES_FR.some((r) => r.percent === percent);
}

/**
 * French intra-community VAT number from a SIREN (fiscal rule, isolated here — never inline).
 * Format: `FR` + 2-digit key + 9-digit SIREN, where key = (12 + 3 × (SIREN mod 97)) mod 97.
 * Returns null if the SIREN is not exactly 9 digits.
 */
export function frenchVatNumberFromSiren(siren: string): string | null {
  const digits = (siren ?? '').replace(/\D/g, '');
  if (digits.length !== 9) return null;
  const key = (12 + 3 * (Number(digits) % 97)) % 97;
  return `FR${String(key).padStart(2, '0')}${digits}`;
}
