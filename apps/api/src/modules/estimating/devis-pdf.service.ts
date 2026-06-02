import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import PDFDocument from 'pdfkit';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { VenteService } from './vente.service';

interface DevisLineRow {
  id: string;
  parent_line_id: string | null;
  type: string;
  code: string | null;
  designation: string;
  unit: string | null;
  quantity: string | null;
  pu: string | null;
  sort_order: number;
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
             FROM affaire_version av JOIN affaire a ON a.id = av.affaire_id
            WHERE av.id = $1`,
          [versionId],
        );
        if (v.length === 0) {
          throw new NotFoundException(`Unknown version "${versionId}"`);
        }
        const l: DevisLineRow[] = await em.query(
          `SELECT id, parent_line_id, type, code, designation, unit, quantity, pu, sort_order
             FROM devis_line WHERE affaire_version_id = $1
            ORDER BY sort_order ASC, created_at ASC`,
          [versionId],
        );
        return { affaire: { code: v[0].code, name: v[0].name, moa: v[0].moa }, version: v[0], lines: l };
      },
    );

    const totals = await this.vente.computeForVersion(versionId);
    const depths = this.computeDepths(lines);

    return this.render(affaire, version, lines, depths, totals);
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
    totals: { totalPvHt: string; tva: string; totalTtc: string },
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text(`Devis ${affaire.code} — ${affaire.name}`);
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#555');
      if (affaire.moa) {
        doc.text(`Maître d'ouvrage : ${affaire.moa}`);
      }
      doc.text(`Version ${version.version_no} — édité le ${new Date().toLocaleDateString('fr-FR')}`);
      doc.moveDown(1).fillColor('#000');

      doc.fontSize(11).text('Désignation', { underline: true });
      doc.moveDown(0.5);

      for (const line of lines) {
        const indent = 40 + (depths.get(line.id) ?? 0) * 16;
        const isTitle = line.type === 'titre' || line.type === 'sous_titre';
        const prefix = line.code ? `${line.code}  ` : '';
        const qty = line.quantity != null ? `  —  ${line.quantity} ${line.unit ?? ''}` : '';
        const pu = line.pu != null ? `  —  PU ${line.pu}` : '';
        doc.fontSize(isTitle ? 11 : 10);
        if (isTitle) {
          doc.fillColor('#1a3b6b');
        } else {
          doc.fillColor('#000');
        }
        doc.text(`${prefix}${line.designation}${qty}${pu}`, indent, doc.y);
      }

      doc.moveDown(1.5).fillColor('#000').fontSize(12);
      doc.text(`Total HT : ${totals.totalPvHt} €`, { align: 'right' });
      doc.text(`TVA : ${totals.tva} €`, { align: 'right' });
      doc.fontSize(13).text(`Total TTC : ${totals.totalTtc} €`, { align: 'right' });

      doc.end();
    });
  }
}
