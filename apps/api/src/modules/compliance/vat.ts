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
