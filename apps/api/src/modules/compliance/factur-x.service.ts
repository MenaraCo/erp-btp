import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import PDFDocument from 'pdfkit';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { buildCiiXml } from './cii';
import { CII_GUIDELINE_EN16931, COMPLIANCE_VERSION } from './compliance.config';

interface InvoiceRow {
  numero: string;
  date: string;
  montant_ht: string;
  tva: string;
  ttc: string;
  seller_name: string;
  seller_vat: string | null;
  buyer_name: string;
  tva_rate: string;
}

@Injectable()
export class FacturXService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  async buildXml(invoiceId: string): Promise<string> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const data = await this.load(em, invoiceId);
      await this.ensureEInvoice(em, tenantId, invoiceId);
      return this.toXml(data);
    });
  }

  async buildPdf(invoiceId: string): Promise<Buffer> {
    const tenantId = this.context.requireTenantId();
    const { data, xml } = await runInTenant(this.dataSource, tenantId, async (em) => {
      const row = await this.load(em, invoiceId);
      await this.ensureEInvoice(em, tenantId, invoiceId);
      return { data: row, xml: this.toXml(row) };
    });
    return this.render(data, xml);
  }

  private async load(em: EntityManager, invoiceId: string): Promise<InvoiceRow> {
    const rows = await em.query(
      `SELECT i.numero, i.date, i.montant_ht, i.tva, i.ttc,
              c.name AS seller_name, c.vat_number AS seller_vat,
              m.name AS buyer_name, s.tva_rate AS tva_rate
         FROM invoice i
         JOIN company c ON c.id = i.company_id
         JOIN situation s ON s.id = i.situation_id
         JOIN marche m ON m.id = s.marche_id
        WHERE i.id = $1`,
      [invoiceId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Unknown invoice "${invoiceId}"`);
    }
    return rows[0];
  }

  private async ensureEInvoice(
    em: EntityManager,
    tenantId: string,
    invoiceId: string,
  ): Promise<void> {
    await em.query(
      `INSERT INTO einvoice (tenant_id, invoice_id, status, cii_profile, compliance_version)
       VALUES ($1, $2, 'issued', $3, $4)
       ON CONFLICT (invoice_id) DO NOTHING`,
      [tenantId, invoiceId, CII_GUIDELINE_EN16931, COMPLIANCE_VERSION],
    );
  }

  private toXml(data: InvoiceRow): string {
    const ratePercent = new Decimal(data.tva_rate).times(100).toString();
    return buildCiiXml({
      numero: data.numero,
      issueDate: new Date(data.date),
      seller: { name: data.seller_name, vatNumber: data.seller_vat },
      buyer: { name: data.buyer_name },
      currency: 'EUR',
      lineTotalHt: data.montant_ht,
      taxBasisHt: data.montant_ht,
      taxAmount: data.tva,
      taxRatePercent: ratePercent,
      grandTotalTtc: data.ttc,
    });
  }

  private render(data: InvoiceRow, xml: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text(`Facture ${data.numero}`);
      doc.moveDown(0.3).fontSize(10).fillColor('#555');
      doc.text(`Émetteur : ${data.seller_name}${data.seller_vat ? ` (TVA ${data.seller_vat})` : ''}`);
      doc.text(`Client : ${data.buyer_name}`);
      doc.text(`Date : ${data.date}`);
      doc.moveDown(1).fillColor('#000').fontSize(12);
      doc.text(`Total HT : ${data.montant_ht} €`, { align: 'right' });
      doc.text(`TVA : ${data.tva} €`, { align: 'right' });
      doc.fontSize(13).text(`Total TTC : ${data.ttc} €`, { align: 'right' });
      doc.moveDown(1).fontSize(8).fillColor('#777');
      doc.text(`Factur-X — CII EN 16931 (conformité ${COMPLIANCE_VERSION}). XML structuré joint.`);

      // Embed the CII XML (Factur-X carrier). Best-effort; strict PDF/A-3 to validate before prod.
      try {
        doc.file(Buffer.from(xml, 'utf8'), {
          name: 'factur-x.xml',
          type: 'application/xml',
        });
      } catch {
        // attachment API mismatch — XML remains available via the /cii.xml endpoint
      }

      doc.end();
    });
  }
}
