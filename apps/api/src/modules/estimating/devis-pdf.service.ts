import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import PDFDocument from 'pdfkit';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { VenteService } from './vente.service';
import { computeLineNumbers } from './devis-numbering';

interface DevisLineRow {
  id: string;
  parent_line_id: string | null;
  type: string;
  designation: string;
  unit: string | null;
  quantity: string | null;
  pu: string | null;
  sort_order: number;
  num_custom: string | null;
}

@Injectable()
export class DevisPdfService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly vente: VenteService,
  ) {}

  async generate(versionId: string): Promise<Buffer> {
    const tenantId = this.context.requireTenantId();
    const { affaire, version, lines } = await runInTenant(
      this.dataSource,
      tenantId,
      async (em) => {
        const v = await em.query(
          `SELECT av.id, av.version_no, a.code, a.name, a.moa
             FROM devis_version av
             JOIN devis d ON d.id = av.devis_id
             JOIN affaire a ON a.id = d.affaire_id
            WHERE av.id = $1`,
          [versionId],
        );
        if (v.length === 0) {
          throw new NotFoundException(`Unknown version "${versionId}"`);
        }
        const l: DevisLineRow[] = await em.query(
          `SELECT id, parent_line_id, type, designation, unit, quantity, pu, sort_order, num_custom
             FROM devis_line WHERE devis_version_id = $1
            ORDER BY sort_order ASC, created_at ASC`,
          [versionId],
        );
        return { affaire: { code: v[0].code, name: v[0].name, moa: v[0].moa }, version: v[0], lines: l };
      },
    );

    const totals = await this.vente.computeForVersion(versionId);
    const depths = this.computeDepths(lines);
    const numbers = computeLineNumbers(lines);

    return this.render(affaire, version, lines, depths, numbers, totals);
  }

  private computeDepths(lines: DevisLineRow[]): Map<string, number> {
    const byId = new Map(lines.map((l) => [l.id, l]));
    const depth = new Map<string, number>();
    const compute = (id: string): number => {
      if (depth.has(id)) {
        return depth.get(id)!;
      }
      const line = byId.get(id);
      const d = line?.parent_line_id ? compute(line.parent_line_id) + 1 : 0;
      depth.set(id, d);
      return d;
    };
    for (const l of lines) {
      compute(l.id);
    }
    return depth;
  }

  private render(
    affaire: { code: string; name: string; moa: string | null },
    version: { version_no: number },
    lines: DevisLineRow[],
    depths: Map<string, number>,
    numbers: Map<string, string>,
    totals: { totalPvHt: string; tva: string; totalTtc: string },
  ): Promise<Buffer> {
    const M = 40; // page margin
    const PAGE_W = 595 - M * 2; // A4 width minus margins
    // Column positions (right-aligned anchors from right edge)
    const COL_PU = M + PAGE_W;        // rightmost: PU
    const COL_UNIT = COL_PU - 60;     // unit
    const COL_QTY = COL_UNIT - 60;    // qty
    const COL_DESIG_MAX = COL_QTY - 8; // designation fits left of qty

    const fmt2 = (v: string | null) => {
      if (v == null) return '';
      const n = parseFloat(v);
      return isNaN(n) ? v : n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: M });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── En-tête ──
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a3a5c')
        .text(`${affaire.code} — ${affaire.name}`);
      doc.moveDown(0.2);
      doc.fontSize(9).font('Helvetica').fillColor('#666');
      if (affaire.moa) doc.text(`Maître d'ouvrage : ${affaire.moa}`);
      doc.text(`Version ${version.version_no}  ·  Édité le ${new Date().toLocaleDateString('fr-FR')}`);
      doc.moveDown(0.8);

      // ── En-têtes colonnes ──
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#888');
      doc.text('Désignation', M, doc.y);
      doc.text('Qté', COL_QTY - 40, doc.y - doc.currentLineHeight(), { width: 40, align: 'right' });
      doc.text('U', COL_UNIT - 40, doc.y - doc.currentLineHeight(), { width: 40, align: 'right' });
      doc.text('PU HT', COL_PU - 55, doc.y - doc.currentLineHeight(), { width: 55, align: 'right' });
      doc.moveDown(0.2);
      doc.moveTo(M, doc.y).lineTo(M + PAGE_W, doc.y).strokeColor('#ccc').stroke();
      doc.moveDown(0.4);

      // ── Lignes ──
      const VISIBLE = new Set(['titre', 'sous_titre', 'ouvrage', 'texte']);
      for (const line of lines) {
        if (!VISIBLE.has(line.type)) continue; // skip ressource (sous-détail)

        const depth = depths.get(line.id) ?? 0;
        const num = numbers.get(line.id) ?? '';
        const isTitle = line.type === 'titre';
        const isSousTitre = line.type === 'sous_titre';
        const isOuvrage = line.type === 'ouvrage';
        const indent = M + depth * 14;

        // Page break guard
        if (doc.y > 760) doc.addPage();

        const rowY = doc.y;

        if (isTitle) {
          // Bande colorée pour les titres
          doc.rect(M, rowY - 2, PAGE_W, 16).fillColor('#1a3a5c').fill();
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#fff');
          if (num) {
            doc.text(num, indent, rowY, { width: 32 });
            doc.text(line.designation, indent + 36, rowY, { width: COL_DESIG_MAX - indent - 36 });
          } else {
            doc.text(line.designation, indent, rowY, { width: COL_DESIG_MAX - indent });
          }
          doc.moveDown(0.6);
        } else if (isSousTitre) {
          doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a3a5c');
          if (num) {
            doc.text(num, indent, rowY, { width: 36 });
            doc.text(line.designation, indent + 40, rowY, { width: COL_DESIG_MAX - indent - 40 });
          } else {
            doc.text(line.designation, indent, rowY, { width: COL_DESIG_MAX - indent });
          }
          doc.moveDown(0.3);
          // underline
          doc.moveTo(indent, doc.y).lineTo(COL_DESIG_MAX, doc.y).strokeColor('#1a3a5c').lineWidth(0.5).stroke();
          doc.moveDown(0.3);
        } else if (isOuvrage) {
          doc.fontSize(9).font('Helvetica').fillColor('#000');
          const numW = 36;
          const desigX = num ? indent + numW : indent;
          const desigW = COL_DESIG_MAX - desigX;
          if (num) {
            doc.font('Helvetica-Bold').fillColor('#e8550a')
              .text(num, indent, rowY, { width: numW });
            doc.font('Helvetica').fillColor('#000');
          }
          doc.text(line.designation, desigX, rowY, { width: desigW });
          // qty + unit + PU on same row
          if (line.quantity != null) {
            const qtyY = rowY;
            doc.text(fmt2(line.quantity), COL_QTY - 55, qtyY, { width: 55, align: 'right' });
            doc.text(line.unit ?? '', COL_UNIT - 40, qtyY, { width: 40, align: 'right' });
            if (line.pu != null) {
              doc.text(fmt2(line.pu), COL_PU - 60, qtyY, { width: 60, align: 'right' });
            }
          }
          doc.moveDown(0.4);
        } else {
          // texte libre
          doc.fontSize(8).font('Helvetica-Oblique').fillColor('#555')
            .text(line.designation, indent, rowY, { width: COL_DESIG_MAX - indent });
          doc.moveDown(0.3);
        }
      }

      // ── Totaux ──
      doc.moveDown(0.8);
      doc.moveTo(M, doc.y).lineTo(M + PAGE_W, doc.y).strokeColor('#1a3a5c').lineWidth(1).stroke();
      doc.moveDown(0.6);
      doc.fontSize(10).font('Helvetica').fillColor('#000');
      doc.text(`Total HT`, M, doc.y, { width: PAGE_W - 80 });
      doc.font('Helvetica-Bold').text(`${fmt2(totals.totalPvHt)} €`, M, doc.y - doc.currentLineHeight(), { width: PAGE_W, align: 'right' });
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(9).fillColor('#555');
      doc.text(`TVA`, M, doc.y);
      doc.text(`${fmt2(totals.tva)} €`, M, doc.y - doc.currentLineHeight(), { width: PAGE_W, align: 'right' });
      doc.moveDown(0.5);
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a3a5c');
      doc.text(`Total TTC`, M, doc.y);
      doc.text(`${fmt2(totals.totalTtc)} €`, M, doc.y - doc.currentLineHeight(), { width: PAGE_W, align: 'right' });

      doc.end();
    });
  }
}
