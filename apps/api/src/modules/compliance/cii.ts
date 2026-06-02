import { CII_GUIDELINE_EN16931 } from './compliance.config';

/**
 * Builds a Factur-X CII (Cross Industry Invoice) XML from invoice data — the structured part of
 * a Factur-X document (profile EN 16931 / BASIC). Pure and deterministic. Strict PDF/A-3
 * conformance of the carrier PDF is to be validated before production.
 */
export interface CiiInvoiceData {
  numero: string;
  issueDate: Date;
  seller: { name: string; vatNumber?: string | null };
  buyer: { name: string };
  currency: string;
  lineTotalHt: string;
  taxBasisHt: string;
  taxAmount: string;
  taxRatePercent: string;
  grandTotalTtc: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dateCode(date: Date): string {
  const y = date.getFullYear().toString().padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function buildCiiXml(data: CiiInvoiceData): string {
  const sellerVat = data.seller.vatNumber
    ? `\n          <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(
        data.seller.vatNumber,
      )}</ram:ID></ram:SpecifiedTaxRegistration>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${CII_GUIDELINE_EN16931}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(data.numero)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${dateCode(data.issueDate)}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${esc(data.seller.name)}</ram:Name>${sellerVat}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${esc(data.buyer.name)}</ram:Name>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${esc(data.currency)}</ram:InvoiceCurrencyCode>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${data.taxAmount}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${data.taxBasisHt}</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>${data.taxRatePercent}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${data.lineTotalHt}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${data.taxBasisHt}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${esc(data.currency)}">${data.taxAmount}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${data.grandTotalTtc}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${data.grandTotalTtc}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}
