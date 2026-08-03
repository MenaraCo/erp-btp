import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import PDFDocument from 'pdfkit';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { visibleForClient, ClientViewLine } from './devis-client-view';
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
  section_type: 'option' | 'variante' | null;
  /** false = ligne de FRAIS : son coût est réparti dans les prix, elle ne se montre pas au client. */
  vendable: boolean;
}

interface CompanyRow {
  name: string | null;
  legal_form: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  siret: string | null;
  siren: string | null;
  vat_intra: string | null;
  rcs: string | null;
  capital: string | null;
  logo_data: string | null;
  logo_mime: string | null;
}

interface ClientRow {
  name: string | null;
  address: { ligne1?: string; code_postal?: string; ville?: string } | null;
}

interface HeaderData {
  company: CompanyRow | null;
  client: ClientRow | null;
  devis: { numero: string | null; designation: string; created_at: Date };
  version: { version_no: number };
  affaire: { code: string; name: string; moa: string | null; lieu: Record<string, unknown> | null };
  colors: { primary: string; accent: string };
}

/**
 * Édition PDF du devis client (Phase 1 — E.1).
 *
 * Points structurants :
 *  - les prix imprimés sont des PRIX DE VENTE (issus de la feuille de vente), jamais le déboursé ;
 *  - chaque ligne porte son MONTANT HT (PV de la ligne), et chaque titre de premier niveau son
 *    sous-total, si bien que le corps du devis se raccorde exactement au total ;
 *  - options et variantes sont exclues du total principal (elles sont éditées par E.3).
 */
@Injectable()
export class DevisPdfService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly vente: VenteService,
  ) {}

  async generate(versionId: string, opts: { bordereau?: boolean } = {}): Promise<Buffer> {
    const tenantId = this.context.requireTenantId();
    const data = await runInTenant(this.dataSource, tenantId, async (em) => {
      const v = await em.query(
        `SELECT av.id, av.version_no, d.numero, d.designation AS devis_designation,
                d.created_at,
                a.code, a.name, a.moa, a.lieu_execution, a.client_id AS affaire_client_id
           FROM devis_version av
           JOIN devis d ON d.id = av.devis_id
           JOIN affaire a ON a.id = d.affaire_id
          WHERE av.id = $1`,
        [versionId],
      );
      if (v.length === 0) {
        throw new NotFoundException(`Unknown version "${versionId}"`);
      }
      const lines: DevisLineRow[] = await em.query(
        `SELECT id, parent_line_id, type, designation, unit, quantity, pu, sort_order,
                num_custom, section_type, vendable
           FROM devis_line WHERE devis_version_id = $1
          ORDER BY sort_order ASC, created_at ASC`,
        [versionId],
      );
      const company: CompanyRow[] = await em.query(
        `SELECT name, legal_form, address, postal_code, city, phone, email, siret, siren,
                vat_intra, rcs, capital, logo_data, logo_mime
           FROM company ORDER BY code ASC LIMIT 1`,
      );
      const prefs = await em.query(
        `SELECT couleur_principale, couleur_accent, nb_decimales FROM company_preferences LIMIT 1`,
      );
      const clientId = v[0].affaire_client_id;
      const client: ClientRow[] = clientId
        ? await em.query(`SELECT name, address FROM client WHERE id = $1`, [clientId])
        : [];
      return { row: v[0], lines, company: company[0] ?? null, client: client[0] ?? null, prefs: prefs[0] ?? null };
    });

    const totals = await this.vente.computeForVersion(versionId);
    const pvByLine = new Map(totals.items.map((i) => [i.id, i.pv]));
    const sectionById = new Map(totals.items.map((i) => [i.id, i.section]));
    const depths = this.computeDepths(data.lines);
    const numbers = computeLineNumbers(data.lines);

    const header: HeaderData = {
      company: data.company,
      client: data.client,
      devis: {
        numero: data.row.numero,
        designation: data.row.devis_designation,
        created_at: data.row.created_at,
      },
      version: { version_no: data.row.version_no },
      affaire: {
        code: data.row.code,
        name: data.row.name,
        moa: data.row.moa,
        lieu: data.row.lieu_execution,
      },
      colors: {
        primary: data.prefs?.couleur_principale || '#1a3a5c',
        accent: data.prefs?.couleur_accent || '#e8550a',
      },
    };
    const decimals = Number(data.prefs?.nb_decimales ?? 2);

    return this.render(
      header, data.lines, depths, numbers, pvByLine, sectionById, totals, decimals,
      Boolean(opts.bordereau),
    );
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

  /** Somme des PV de la sous-arborescence d'une ligne (sous-total de titre). */
  private subtreeTotal(
    lineId: string,
    childrenOf: Map<string | null, DevisLineRow[]>,
    pvByLine: Map<string, string>,
  ): number {
    const own = pvByLine.get(lineId);
    if (own != null) {
      return Number(own);
    }
    return (childrenOf.get(lineId) ?? []).reduce(
      (acc, c) => acc + this.subtreeTotal(c.id, childrenOf, pvByLine),
      0,
    );
  }

  private render(
    h: HeaderData,
    lines: DevisLineRow[],
    depths: Map<string, number>,
    numbers: Map<string, string>,
    pvByLine: Map<string, string>,
    sectionById: Map<string, string>,
    totals: {
      totalPvHt: string;
      pvDevis: string;
      remise: string;
      fraisAnnexes: string;
      fraisDetail?: { designation: string; montant: string }[];
      tva: string;
      totalTtc: string;
      optionsPvHt: string;
      variantesPvHt: string;
    },
    decimals: number,
    /**
     * Mode BORDEREAU (appel d'offre) : la structure et les quantités sont imprimées, mais les
     * prix sont laissés vides — le soumissionnaire les complète. Aucun total n'est affiché.
     */
    bordereau = false,
  ): Promise<Buffer> {
    const M = 40;
    const PAGE_W = 595 - M * 2;
    const RIGHT = M + PAGE_W;
    // Colonnes (bornes droites) : U · Qté · P.U. HT · Montant HT
    const COL_MT = RIGHT;
    const COL_PU = COL_MT - 78;
    const COL_QTY = COL_PU - 58;
    // La quantité est cadrée à droite sur 58 pt : l'unité doit finir avant, sinon les deux
    // colonnes se chevauchent (« M21 000,00 »).
    const COL_UNIT = COL_QTY - 62;
    const DESIG_MAX = COL_UNIT - 34;
    const FOOTER_Y = 800;

    const nf = (v: number | string | null | undefined, dec = decimals) => {
      const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
      if (n == null || Number.isNaN(n)) return '';
      // toLocaleString('fr-FR') sépare les milliers par une espace fine insécable (U+202F),
      // absente de l'encodage WinAnsi de Helvetica → elle s'imprimerait « / ». On normalise.
      return n
        .toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
        .replace(/[\u202F\u00A0]/g, ' ');
    };
    const money = (v: number | string | null | undefined) => `${nf(v)} €`;

    // Enfants par parent, pour les sous-totaux de titre.
    const childrenOf = new Map<string | null, DevisLineRow[]>();
    for (const l of lines) {
      const k = l.parent_line_id;
      if (!childrenOf.has(k)) childrenOf.set(k, []);
      childrenOf.get(k)!.push(l);
    }

    const c = h.company;
    const companyLines = [
      [c?.address].filter(Boolean).join(''),
      [c?.postal_code, c?.city].filter(Boolean).join(' '),
      [c?.phone && `Tél. ${c.phone}`, c?.email].filter(Boolean).join('  ·  '),
    ].filter((s) => s && s.trim().length > 0);

    const legalLine = [
      c?.legal_form && c?.capital ? `${c.legal_form} au capital de ${nf(c.capital, 0)} €` : c?.legal_form,
      c?.siret && `SIRET ${c.siret}`,
      c?.rcs && `RCS ${c.rcs}`,
      c?.vat_intra && `TVA ${c.vat_intra}`,
    ]
      .filter(Boolean)
      .join('  ·  ');

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (x: Buffer) => chunks.push(x));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      /* ────────── En-tête société ────────── */
      let headTop = M;
      if (c?.logo_data) {
        try {
          doc.image(Buffer.from(c.logo_data, 'base64'), M, headTop, { fit: [130, 46] });
          headTop += 52;
        } catch {
          // logo illisible : on continue sans bloquer l'édition
        }
      }
      doc.fontSize(13).font('Helvetica-Bold').fillColor(h.colors.primary)
        .text(c?.name ?? '', M, headTop, { width: PAGE_W / 2 });
      doc.fontSize(8).font('Helvetica').fillColor('#555');
      for (const l of companyLines) {
        doc.text(l, M, doc.y, { width: PAGE_W / 2 });
      }

      /* ────────── Cartouche devis (à droite) ────────── */
      const boxW = 210;
      const boxX = RIGHT - boxW;
      doc.roundedRect(boxX, M, boxW, 74, 4).fillAndStroke('#f8fafc', '#cbd5e1');
      doc.fillColor(h.colors.primary).fontSize(bordereau ? 12 : 15).font('Helvetica-Bold')
        .text(bordereau ? 'BORDEREAU DE PRIX' : 'DEVIS', boxX + 10, M + 8, { width: boxW - 20 });
      doc.fontSize(8).font('Helvetica').fillColor('#334155');
      const ref = h.devis.numero ?? h.affaire.code;
      doc.text(`N° ${ref}${h.version.version_no > 1 ? `  (v${h.version.version_no})` : ''}`, boxX + 10, M + 28, { width: boxW - 20 });
      doc.text(`Date : ${new Date(h.devis.created_at).toLocaleDateString('fr-FR')}`, boxX + 10, doc.y, { width: boxW - 20 });
      doc.text(`Édité le ${new Date().toLocaleDateString('fr-FR')}`, boxX + 10, doc.y, { width: boxW - 20 });

      /* ────────── Destinataire ────────── */
      let y = Math.max(doc.y, M + 84) + 12;
      if (h.client) {
        const cliW = 240;
        const cliX = RIGHT - cliW;
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#94a3b8')
          .text('DESTINATAIRE', cliX, y, { width: cliW });
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a')
          .text(h.client.name ?? '', cliX, doc.y + 2, { width: cliW });
        doc.fontSize(9).font('Helvetica').fillColor('#334155');
        const a = h.client.address ?? {};
        if (a.ligne1) doc.text(a.ligne1, cliX, doc.y, { width: cliW });
        const cp = [a.code_postal, a.ville].filter(Boolean).join(' ');
        if (cp) doc.text(cp, cliX, doc.y, { width: cliW });
        y = doc.y + 14;
      }

      /* ────────── Objet / chantier ────────── */
      doc.fontSize(11).font('Helvetica-Bold').fillColor(h.colors.primary)
        .text(`${h.affaire.code} — ${h.affaire.name}`, M, y, { width: PAGE_W - 250 });
      doc.fontSize(8).font('Helvetica').fillColor('#555');
      if (h.devis.designation && h.devis.designation !== h.affaire.name) {
        doc.text(h.devis.designation, M, doc.y, { width: PAGE_W - 250 });
      }
      if (h.affaire.moa) doc.text(`Maître d'ouvrage : ${h.affaire.moa}`, M, doc.y, { width: PAGE_W - 250 });
      const lieu = h.affaire.lieu as { ligne1?: string; code_postal?: string; ville?: string } | null;
      if (lieu && (lieu.ligne1 || lieu.ville)) {
        doc.text(
          `Lieu d'exécution : ${[lieu.ligne1, lieu.code_postal, lieu.ville].filter(Boolean).join(' ')}`,
          M, doc.y, { width: PAGE_W - 250 },
        );
      }
      if (bordereau) {
        doc.moveDown(0.4);
        doc.fontSize(8).font('Helvetica-Oblique').fillColor(h.colors.accent)
          .text(
            "Bordereau de prix — merci de compléter les prix unitaires et les montants. "
            + 'Les quantités sont indiquées à titre contractuel.',
            M, doc.y, { width: PAGE_W - 250 },
          );
      }
      doc.moveDown(0.8);

      /* ────────── En-tête de colonnes (répété à chaque page) ────────── */
      const drawColumnHeader = () => {
        const hy = doc.y;
        doc.rect(M, hy - 2, PAGE_W, 16).fill('#eef2f7');
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#475569');
        doc.text('DÉSIGNATION', M + 4, hy + 3, { width: DESIG_MAX - M });
        doc.text('U', COL_UNIT - 30, hy + 3, { width: 30, align: 'right' });
        doc.text('QTÉ', COL_QTY - 58, hy + 3, { width: 58, align: 'right' });
        // Libellés courts : la consigne « à compléter » figure déjà en tête de document.
        doc.text('P.U. HT', COL_PU - 58, hy + 3, { width: 58, align: 'right' });
        doc.text('MONTANT HT', COL_MT - 74, hy + 3, { width: 74, align: 'right' });
        doc.y = hy + 20;
      };
      drawColumnHeader();

      const ensureRoom = (needed: number) => {
        if (doc.y + needed > FOOTER_Y - 30) {
          doc.addPage();
          doc.y = M;
          drawColumnHeader();
        }
      };

      /* ────────── Corps ────────── */
      const VISIBLE = new Set(['titre', 'sous_titre', 'ouvrage', 'ressource', 'texte']);
      // Parcours en profondeur : le devis s'imprime dans l'ordre de l'arborescence,
      // et non dans l'ordre à plat de la table (sort_order n'est unique que par fratrie).
      const walk = (parentId: string | null, render: (l: DevisLineRow) => void) => {
        for (const child of (childrenOf.get(parentId) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)) {
          render(child);
          // Le sous-détail d'un ouvrage ne s'imprime pas côté client.
          if (child.type !== 'ouvrage') walk(child.id, render);
        }
      };
      // Ce que le client voit : ni lignes de frais, ni titre qui ne contiendrait qu'elles
      // (règle partagée avec l'aperçu et l'écran « Devis client »).
      const vuClient = visibleForClient(
        lines.map((l) => ({
          id: l.id,
          parentLineId: l.parent_line_id,
          type: l.type,
          vendable: l.vendable !== false,
        })),
        (l: ClientViewLine) => {
          const sec = sectionById.get(l.id);
          return Boolean(sec) && sec !== 'main';
        },
      );

      walk(null, (line) => {
        // Options et variantes sont hors du devis principal (édition dédiée : E.3).
        if (sectionById.get(line.id) && sectionById.get(line.id) !== 'main') return;
        if (!VISIBLE.has(line.type)) return;
        if (!vuClient.has(line.id)) return;

        const depth = depths.get(line.id) ?? 0;
        const indent = M + Math.min(depth, 3) * 10;
        const num = numbers.get(line.id) ?? line.num_custom ?? '';
        const isTitre = line.type === 'titre' || line.type === 'sous_titre';

        if (isTitre) {
          ensureRoom(30);
          const ty = doc.y + 4;
          const isTop = depth === 0;
          const sub = this.subtreeTotal(line.id, childrenOf, pvByLine);
          if (isTop) {
            doc.rect(M, ty - 2, PAGE_W, 17).fill(h.colors.primary);
            doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#fff');
            doc.text(`${num}  ${line.designation}`.trim(), M + 5, ty + 2, { width: DESIG_MAX - M });
            if (!bordereau) doc.text(money(sub), COL_MT - 90, ty + 2, { width: 90, align: 'right' });
            doc.y = ty + 21;
          } else {
            doc.fontSize(9).font('Helvetica-Bold').fillColor(h.colors.primary);
            doc.text(`${num}  ${line.designation}`.trim(), indent, ty, { width: DESIG_MAX - indent });
            if (!bordereau) doc.text(money(sub), COL_MT - 90, ty, { width: 90, align: 'right' });
            doc.moveDown(0.4);
          }
          return;
        }

        if (line.type === 'texte') {
          ensureRoom(18);
          doc.fontSize(8).font('Helvetica-Oblique').fillColor('#555')
            .text(line.designation, indent, doc.y, { width: DESIG_MAX - indent });
          doc.moveDown(0.3);
          return;
        }

        // Ouvrage / ressource facturable : PRIX DE VENTE (jamais le déboursé).
        ensureRoom(24);
        const rowY = doc.y;
        const pv = pvByLine.get(line.id);
        const qty = line.quantity != null ? Number(line.quantity) : null;
        const pu = pv != null && qty ? Number(pv) / qty : null;

        doc.fontSize(8.5).font('Helvetica').fillColor('#0f172a');
        const numW = num ? 40 : 0;
        if (num) {
          doc.font('Helvetica-Bold').fillColor(h.colors.accent)
            .text(num, indent, rowY, { width: numW - 4 });
          doc.font('Helvetica').fillColor('#0f172a');
        }
        doc.text(line.designation, indent + numW, rowY, { width: DESIG_MAX - indent - numW });
        const endY = doc.y;
        doc.text(line.unit ?? '', COL_UNIT - 30, rowY, { width: 30, align: 'right' });
        if (qty != null) doc.text(nf(qty), COL_QTY - 58, rowY, { width: 58, align: 'right' });
        if (bordereau) {
          // Cases à compléter : un filet discret sous chaque colonne de prix.
          if (qty != null) {
            const by = rowY + 9;
            doc.moveTo(COL_PU - 56, by).lineTo(COL_PU, by).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
            doc.moveTo(COL_MT - 72, by).lineTo(COL_MT, by).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
          }
        } else {
          if (pu != null) doc.text(nf(pu), COL_PU - 58, rowY, { width: 58, align: 'right' });
          if (pv != null) {
            doc.font('Helvetica-Bold')
              .text(money(pv), COL_MT - 74, rowY, { width: 74, align: 'right' });
            doc.font('Helvetica');
          }
        }
        doc.y = Math.max(endY, rowY + 12);
        doc.moveTo(M, doc.y + 2).lineTo(RIGHT, doc.y + 2).strokeColor('#eef2f7').lineWidth(0.5).stroke();
        doc.moveDown(0.35);
      });

      /* ────────── Totaux ────────── */
      // En bordereau, aucun montant n'est communiqué : les totaux, le récapitulatif par lot
      // et les options chiffrées sont omis — c'est au soumissionnaire de les établir.
      if (!bordereau) {
      ensureRoom(110);
      doc.moveDown(0.6);
      const tX = RIGHT - 250;
      const totRow = (label: string, value: string, opts?: { bold?: boolean; big?: boolean }) => {
        const ry = doc.y;
        doc.fontSize(opts?.big ? 11 : 9)
          .font(opts?.bold || opts?.big ? 'Helvetica-Bold' : 'Helvetica')
          .fillColor(opts?.big ? h.colors.primary : '#334155');
        doc.text(label, tX, ry, { width: 140 });
        doc.text(value, tX + 140, ry, { width: 110, align: 'right' });
        doc.moveDown(0.42);
      };
      doc.moveTo(tX, doc.y).lineTo(RIGHT, doc.y).strokeColor(h.colors.primary).lineWidth(1).stroke();
      doc.moveDown(0.4);
      const detail = totals.fraisDetail ?? [];
      if (Number(totals.fraisAnnexes) > 0.005) {
        totRow('Sous-total travaux HT', money(Number(totals.pvDevis) - Number(totals.fraisAnnexes)));
        // Chaque poste garde SON intitulé et sa propre ligne : jamais de regroupement sous un
        // libellé générique « Frais annexes ».
        if (detail.length > 0) {
          for (const f of detail) {
            totRow(f.designation || 'Frais', money(f.montant));
          }
        } else {
          totRow('Frais annexes', money(totals.fraisAnnexes));
        }
      }
      if (Number(totals.remise) > 0.005) {
        totRow('Remise', `- ${money(totals.remise)}`);
      }
      totRow('Total HT', money(totals.totalPvHt), { bold: true });
      totRow('TVA', money(totals.tva));
      doc.moveDown(0.15);
      totRow('Total TTC', money(totals.totalTtc), { big: true });

      /* ────────── Récapitulatif par lot (après les totaux) ────────── */
      const topTitres = (childrenOf.get(null) ?? []).filter(
        (l) => (l.type === 'titre' || l.type === 'sous_titre') && !sectionById.get(l.id),
      );
      if (topTitres.length > 1) {
        ensureRoom(40 + topTitres.length * 14);
        doc.moveDown(0.6);
        doc.fontSize(9).font('Helvetica-Bold').fillColor(h.colors.primary)
          .text('Récapitulatif par lot', M, doc.y);
        doc.moveDown(0.3);
        doc.fontSize(8.5).font('Helvetica').fillColor('#334155');
        for (const t of topTitres) {
          const sub = this.subtreeTotal(t.id, childrenOf, pvByLine);
          const ry = doc.y;
          doc.text(`${numbers.get(t.id) ?? ''}  ${t.designation}`.trim(), M + 4, ry, { width: DESIG_MAX - M });
          doc.text(money(sub), COL_MT - 90, ry, { width: 90, align: 'right' });
          doc.moveDown(0.35);
        }
      }


      /* ────────── Options & variantes (hors total du marché) ────────── */
      const extras = lines.filter((l) => {
        const sec = sectionById.get(l.id);
        return (sec === 'option' || sec === 'variante') && (l.type === 'titre' || l.type === 'sous_titre' || l.type === 'ouvrage');
      });
      if (extras.length > 0 || Number(totals.optionsPvHt) > 0.005 || Number(totals.variantesPvHt) > 0.005) {
        ensureRoom(60);
        doc.moveDown(0.8);
        doc.fontSize(9).font('Helvetica-Bold').fillColor(h.colors.accent)
          .text('Options et variantes', M, doc.y);
        doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#64748b')
          .text('Chiffrées à titre indicatif — non comprises dans le total ci-dessus.', M, doc.y + 1);
        doc.moveDown(0.4);
        doc.fontSize(8.5).font('Helvetica').fillColor('#334155');
        for (const l of extras) {
          const pv = pvByLine.get(l.id);
          const sub = pv != null ? Number(pv) : this.subtreeTotal(l.id, childrenOf, pvByLine);
          if (Math.abs(sub) < 0.005) continue;
          const ry = doc.y;
          const tag = sectionById.get(l.id) === 'option' ? 'Option' : 'Variante';
          doc.text(`${tag} · ${numbers.get(l.id) ?? ''} ${l.designation}`.trim(), M + 4, ry, { width: DESIG_MAX - M });
          doc.text(money(sub), COL_MT - 90, ry, { width: 90, align: 'right' });
          doc.moveDown(0.35);
        }
        if (Number(totals.optionsPvHt) > 0.005) {
          const ry = doc.y;
          doc.font('Helvetica-Bold');
          doc.text('Total options HT', M + 4, ry, { width: DESIG_MAX - M });
          doc.text(money(totals.optionsPvHt), COL_MT - 90, ry, { width: 90, align: 'right' });
          doc.font('Helvetica');
          doc.moveDown(0.35);
        }
        if (Number(totals.variantesPvHt) > 0.005) {
          const ry = doc.y;
          doc.font('Helvetica-Bold');
          doc.text('Total variantes HT', M + 4, ry, { width: DESIG_MAX - M });
          doc.text(money(totals.variantesPvHt), COL_MT - 90, ry, { width: 90, align: 'right' });
          doc.font('Helvetica');
          doc.moveDown(0.35);
        }
      }

      } // fin du bloc « hors bordereau »

      if (bordereau) {
        // Cartouche de récapitulation à compléter par le soumissionnaire.
        ensureRoom(90);
        doc.moveDown(1);
        const bX = RIGHT - 250;
        doc.moveTo(bX, doc.y).lineTo(RIGHT, doc.y).strokeColor(h.colors.primary).lineWidth(1).stroke();
        doc.moveDown(0.5);
        doc.fontSize(9).font('Helvetica').fillColor('#334155');
        for (const l of ['Total HT', 'TVA', 'Total TTC']) {
          const ry = doc.y;
          doc.text(l, bX, ry, { width: 120 });
          doc.moveTo(bX + 130, ry + 10).lineTo(RIGHT, ry + 10).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
          doc.moveDown(0.9);
        }
        doc.moveDown(0.6);
        doc.fontSize(8).font('Helvetica').fillColor('#334155');
        doc.text('Date :', M, doc.y);
        doc.moveDown(1.2);
        doc.text('Cachet et signature du soumissionnaire :', M, doc.y);
      }

      /* ────────── Pied de page sur toutes les pages ────────── */
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        // Sans cela, écrire près du bas déclenche une pagination et crée une page vide.
        doc.page.margins.bottom = 0;
        doc.moveTo(M, FOOTER_Y - 6).lineTo(RIGHT, FOOTER_Y - 6).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
        doc.fontSize(6.5).font('Helvetica').fillColor('#94a3b8');
        if (legalLine) {
          doc.text(legalLine, M, FOOTER_Y, { width: PAGE_W - 70 });
        }
        doc.text(`Page ${i + 1} / ${range.count}`, RIGHT - 70, FOOTER_Y, { width: 70, align: 'right' });
      }

      doc.end();
    });
  }
}
