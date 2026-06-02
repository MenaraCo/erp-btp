/**
 * Versioned compliance module (cahier des charges §7): all fiscal/legal rules (TVA, Factur-X,
 * Chorus Pro) live here and are versioned, never scattered across business logic. The regulatory
 * calendar evolves — bump COMPLIANCE_VERSION and adapt rules here, in isolation.
 *
 * ⚠️ Verify French e-invoicing dates/obligations (PPF / plateformes agréées) before production.
 */
export const COMPLIANCE_VERSION = 'fr-2026.1';

/** Factur-X / EN 16931 guideline identifier used in the CII XML. */
export const CII_GUIDELINE_EN16931 =
  'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic';
