import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import PDFDocument from 'pdfkit';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

const M = 40;
const PAGE_W = 595.28 - M * 2;
const RIGHT = 595.28 - M;
/** Ligne de pied de page, sous le contenu et au-dessus du bord de la feuille A4. */
const FOOTER_Y = 806;

/**
 * Édition PDF du bon de commande — le document que le fournisseur reçoit.
 *
 * C'est la SEULE sortie officielle d'une commande : elle doit donc porter tout ce qui engage
 * (numéro, adresse et date de livraison, conditions) et rien qui ne regarde que nous — ni marge,
 * ni code analytique, ni ouvrage. Ces imputations servent notre comptabilité analytique ; les
 * afficher au fournisseur donnerait à lire une organisation interne qui ne le concerne pas.
 *
 * L'aperçu et l'envoi partagent ce même rendu : ce qu'on relit à l'écran est exactement ce qui
 * part.
 */
@Injectable()
export class CommandePdfService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  generate(orderId: string): Promise<Buffer> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const commande = (await em.query(
        `SELECT o.*, o.delivery_date::text AS delivery_date,
                s.name AS fournisseur, s.address AS fournisseur_adresse,
                c.code AS chantier_code, c.name AS chantier_nom
           FROM purchase_order o
           LEFT JOIN supplier s ON s.id = o.supplier_id
           LEFT JOIN chantier c ON c.id = o.chantier_id
          WHERE o.id = $1`,
        [orderId],
      ))[0];
      if (!commande) throw new NotFoundException(`Unknown purchase order "${orderId}"`);

      const lignes = await em.query(
        `SELECT code, designation, kind, unite_achat, quantity, unit_price, amount_ht
           FROM purchase_order_line
          WHERE order_id = $1
          ORDER BY sort_order ASC, created_at ASC`,
        [orderId],
      );
      const company = (await em.query(
        `SELECT name, legal_form, address, postal_code, city, phone, email, siret, rcs,
                vat_intra, capital, logo_data
           FROM company ORDER BY code ASC LIMIT 1`,
      ))[0] ?? null;
      const prefs = (await em.query(
        `SELECT couleur_principale, couleur_accent FROM company_preferences LIMIT 1`,
      ))[0] ?? null;

      return this.dessiner({
        commande,
        lignes,
        company,
        couleurs: {
          primary: prefs?.couleur_principale ?? '#1a3a5c',
          accent: prefs?.couleur_accent ?? '#e8550a',
        },
      });
    });
  }

  private dessiner(d: {
    commande: Record<string, unknown>;
    lignes: Array<Record<string, unknown>>;
    company: Record<string, unknown> | null;
    couleurs: { primary: string; accent: string };
  }): Promise<Buffer> {
    const { commande: o, lignes, company: c, couleurs } = d;
    const nf = (v: unknown, dec = 2) =>
      new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
        .format(Number(v ?? 0)).replace(/[\u202F\u00A0]/g, ' ');
    const money = (v: unknown) => `${nf(v)} €`;
    const jour = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('fr-FR') : '—');

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (x: Buffer) => chunks.push(x));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      /* ── En-tête société ── */
      let headTop = M;
      if (c?.logo_data) {
        try {
          doc.image(Buffer.from(String(c.logo_data), 'base64'), M, headTop, { fit: [130, 46] });
          headTop += 52;
        } catch {
          // Logo illisible : le document part quand même, c'est l'essentiel.
        }
      }
      doc.fontSize(13).font('Helvetica-Bold').fillColor(couleurs.primary)
        .text(String(c?.name ?? ''), M, headTop, { width: PAGE_W / 2 });
      doc.fontSize(8).font('Helvetica').fillColor('#555');
      for (const l of [
        String(c?.address ?? ''),
        [c?.postal_code, c?.city].filter(Boolean).join(' '),
        [c?.phone && `Tél. ${c.phone}`, c?.email].filter(Boolean).join('  ·  '),
      ].filter((s) => s && s.trim())) {
        doc.text(l, M, doc.y, { width: PAGE_W / 2 });
      }

      /* ── Cartouche commande ── */
      const boxW = 210;
      const boxX = RIGHT - boxW;
      doc.roundedRect(boxX, M, boxW, 78, 4).fillAndStroke('#f8fafc', '#cbd5e1');
      doc.fillColor(couleurs.primary).fontSize(14).font('Helvetica-Bold')
        .text('BON DE COMMANDE', boxX + 10, M + 8, { width: boxW - 20 });
      doc.fontSize(8).font('Helvetica').fillColor('#334155');
      doc.text(`N° ${o.code}`, boxX + 10, M + 30, { width: boxW - 20 });
      doc.text(`Date : ${jour(o.validated_at ?? o.created_at)}`, boxX + 10, doc.y, { width: boxW - 20 });
      if (o.delivery_date) {
        doc.font('Helvetica-Bold').fillColor(couleurs.accent)
          .text(`Livraison souhaitée : ${jour(o.delivery_date)}`, boxX + 10, doc.y, { width: boxW - 20 });
        doc.font('Helvetica').fillColor('#334155');
      }
      if (o.chantier_code) {
        doc.text(`Chantier : ${o.chantier_code}`, boxX + 10, doc.y, { width: boxW - 20 });
      }

      /* ── Fournisseur ── */
      let y = Math.max(doc.y, M + 88) + 14;
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#94a3b8').text('FOURNISSEUR', M, y);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a')
        .text(String(o.fournisseur ?? '—'), M, doc.y + 2, { width: 260 });
      if (o.contact) {
        doc.fontSize(9).font('Helvetica').fillColor('#334155')
          .text(`À l'attention de ${o.contact}`, M, doc.y, { width: 260 });
      }

      /* ── Livraison ── */
      y = doc.y + 12;
      const bloc = (titre: string, valeur: string, x: number, largeur: number) => {
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#94a3b8').text(titre, x, y, { width: largeur });
        doc.fontSize(9).font('Helvetica').fillColor('#334155')
          .text(valeur || '—', x, doc.y + 1, { width: largeur });
      };
      const demiLargeur = PAGE_W / 2 - 10;
      bloc('ADRESSE DE LIVRAISON', String(o.delivery_address ?? ''), M, demiLargeur);
      const apresAdresse = doc.y;
      bloc('CONDITIONS DE LIVRAISON', String(o.delivery_conditions ?? ''), M + PAGE_W / 2 + 10, demiLargeur);
      y = Math.max(apresAdresse, doc.y) + 14;

      /* ── Lignes ── */
      const cols = [
        { t: 'Code', x: M, w: 70, a: 'left' as const },
        { t: 'Désignation', x: M + 72, w: 210, a: 'left' as const },
        { t: 'Unité', x: M + 286, w: 40, a: 'center' as const },
        { t: 'Qté', x: M + 328, w: 50, a: 'right' as const },
        { t: 'P.U. HT', x: M + 380, w: 60, a: 'right' as const },
        { t: 'Montant HT', x: M + 442, w: 73, a: 'right' as const },
      ];
      const enTete = (top: number) => {
        doc.rect(M, top, PAGE_W, 16).fill(couleurs.primary);
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff');
        for (const col of cols) {
          doc.text(col.t, col.x + 2, top + 4, { width: col.w - 4, align: col.a });
        }
        return top + 18;
      };
      y = enTete(y);

      doc.fontSize(8.5).font('Helvetica').fillColor('#1e293b');
      for (const l of lignes) {
        // Saut de page : l'en-tête de colonnes se rappelle, sinon la suite devient illisible.
        if (y > 760) {
          doc.addPage();
          y = enTete(M);
          doc.fontSize(8.5).font('Helvetica').fillColor('#1e293b');
        }
        if (l.kind === 'comment') {
          doc.font('Helvetica-Oblique').fillColor('#64748b')
            .text(String(l.designation ?? ''), cols[1].x, y, { width: PAGE_W - 80 });
          doc.font('Helvetica').fillColor('#1e293b');
          y = doc.y + 4;
          continue;
        }
        const hauteur = doc.heightOfString(String(l.designation ?? ''), { width: cols[1].w - 4 });
        doc.text(String(l.code ?? ''), cols[0].x + 2, y, { width: cols[0].w - 4 });
        doc.text(String(l.designation ?? ''), cols[1].x + 2, y, { width: cols[1].w - 4 });
        doc.text(String(l.unite_achat ?? ''), cols[2].x + 2, y, { width: cols[2].w - 4, align: 'center' });
        doc.text(nf(l.quantity, 2), cols[3].x + 2, y, { width: cols[3].w - 4, align: 'right' });
        doc.text(money(l.unit_price), cols[4].x + 2, y, { width: cols[4].w - 4, align: 'right' });
        doc.text(money(l.amount_ht), cols[5].x + 2, y, { width: cols[5].w - 4, align: 'right' });
        y += Math.max(hauteur, 11) + 5;
        doc.moveTo(M, y - 2).lineTo(RIGHT, y - 2).strokeColor('#eef2f7').lineWidth(0.5).stroke();
      }

      /* ── Total ── */
      y += 6;
      doc.roundedRect(RIGHT - 200, y, 200, 26, 4).fillAndStroke('#f8fafc', '#cbd5e1');
      doc.fontSize(10).font('Helvetica-Bold').fillColor(couleurs.primary)
        .text('TOTAL HT', RIGHT - 192, y + 8, { width: 90 });
      doc.text(money(o.total_ht), RIGHT - 100, y + 8, { width: 92, align: 'right' });
      y += 38;

      /* ── Conditions et observations ── */
      doc.fontSize(8).font('Helvetica').fillColor('#475569');
      if (o.payment_terms) {
        doc.font('Helvetica-Bold').text('Règlement : ', M, y, { continued: true })
          .font('Helvetica').text(String(o.payment_terms));
        y = doc.y + 4;
      }
      if (o.notes) {
        doc.font('Helvetica-Bold').text('Observations : ', M, y, { continued: true })
          .font('Helvetica').text(String(o.notes), { width: PAGE_W });
        y = doc.y + 4;
      }

      /* ── Pied de page sur chaque page ── */
      const legal = [
        c?.legal_form && c?.capital ? `${c.legal_form} au capital de ${nf(c.capital, 0)} €` : c?.legal_form,
        c?.siret && `SIRET ${c.siret}`,
        c?.rcs && `RCS ${c.rcs}`,
        c?.vat_intra && `TVA ${c.vat_intra}`,
      ].filter(Boolean).join('  ·  ');
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i += 1) {
        doc.switchToPage(pages.start + i);
        // Sans annuler la marge basse, écrire près du bord déclenche une pagination : pdfkit
        // ajoute une page à CHAQUE pied de page, et le document se termine sur des pages vides.
        doc.page.margins.bottom = 0;
        doc.moveTo(M, FOOTER_Y - 6).lineTo(RIGHT, FOOTER_Y - 6)
          .strokeColor('#e2e8f0').lineWidth(0.5).stroke();
        doc.fontSize(6.5).font('Helvetica').fillColor('#94a3b8');
        if (legal) doc.text(legal, M, FOOTER_Y, { width: PAGE_W - 70 });
        doc.text(`Page ${i + 1} / ${pages.count}`, RIGHT - 70, FOOTER_Y, { width: 70, align: 'right' });
      }

      doc.end();
    });
  }
}
