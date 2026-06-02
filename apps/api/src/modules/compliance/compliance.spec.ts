import { buildCiiXml } from './cii';
import { isValidVatPercent, vatRateByCode, VAT_RATES_FR } from './vat';
import {
  assertTransition,
  canTransition,
  InvalidEInvoiceTransitionError,
} from './einvoice-status';

describe('compliance — TVA (versionné)', () => {
  it('valide les taux de TVA FR connus', () => {
    expect(isValidVatPercent(20)).toBe(true);
    expect(isValidVatPercent(5.5)).toBe(true);
    expect(isValidVatPercent(7)).toBe(false);
  });

  it('expose l’autoliquidation sous-traitance BTP à 0%', () => {
    expect(vatRateByCode('autoliquidation')?.percent).toBe(0);
    expect(VAT_RATES_FR.length).toBeGreaterThanOrEqual(5);
  });
});

describe('compliance — statuts e-facture', () => {
  it('suit le cycle issued -> submitted -> accepted -> paid', () => {
    expect(canTransition('issued', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'accepted')).toBe(true);
    expect(canTransition('accepted', 'paid')).toBe(true);
  });

  it('refuse une transition invalide', () => {
    expect(() => assertTransition('issued', 'paid')).toThrow(InvalidEInvoiceTransitionError);
  });
});

describe('compliance — CII XML (Factur-X)', () => {
  it('produit un CII avec les éléments clés', () => {
    const xml = buildCiiXml({
      numero: 'FAC-2026-00001',
      issueDate: new Date('2026-06-02T10:00:00Z'),
      seller: { name: 'Entreprise Démo', vatNumber: 'FR12345678901' },
      buyer: { name: 'Client & Co' },
      currency: 'EUR',
      lineTotalHt: '200.00',
      taxBasisHt: '200.00',
      taxAmount: '40.00',
      taxRatePercent: '20',
      grandTotalTtc: '240.00',
    });
    expect(xml).toContain('<ram:ID>FAC-2026-00001</ram:ID>');
    expect(xml).toContain('<ram:TypeCode>380</ram:TypeCode>');
    expect(xml).toContain('urn:cen.eu:en16931:2017');
    expect(xml).toContain('<ram:GrandTotalAmount>240.00</ram:GrandTotalAmount>');
    expect(xml).toContain('20260602'); // issue date code
    expect(xml).toContain('Client &amp; Co'); // escaping
  });
});
