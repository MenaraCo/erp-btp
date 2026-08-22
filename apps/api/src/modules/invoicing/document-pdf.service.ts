import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import PDFDocument from 'pdfkit';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  CouleursSociete, dessinerEnTete, dessinerEnteteTableau, fondLigne, modelePdf, StyleModele,
} from '../../core/pdf/modele-pdf';

interface SocieteRow {
  name: string | null; legal_form: string | null; address: string | null;
  postal_code: string | null; city: string | null; phone: string | null; email: string | null;
  siret: string | null; vat_intra: string | null; rcs: string | null; capital: string | null;
  logo_data: string | null;
}
interface LigneDocument {
  designation: string;
  unit: string | null;
  quantite: string | null;
  pu: string | null;
  montant_marche: string | null;
  pct: string | null;
  cumul: string;
  /** Un titre porte un sous-total et ne se lit pas comme une prestation. */
  titre: boolean;
}
interface PiedLigne {
  libelle: string;
  montant: string;
  /** Ligne de total : elle porte le poids visuel. */
  fort?: boolean;
  /** Une déduction s'imprime en négatif — le lecteur doit voir qu'on retire. */
  deduction?: boolean;
}

/**
 * Édition des pièces de FACTURATION : situation de travaux, facture, décompte général définitif.
 *
 * Ce sont les documents que le client reçoit — les seuls, avec le devis, à sortir de l'entreprise.
 * Ils partagent donc le même noyau de mise en page que le devis et le bon de commande : même
 * en-tête, même modèle choisi dans les Préférences, mêmes couleurs. Une facture qui ne ressemble
 * pas au devis qu'elle solde oblige le client à vérifier qu'elle vient bien de vous.
 *
 * Le corps d'une situation n'est pas un simple relevé de lignes : il montre, pour chaque poste,
 * ce que le marché prévoyait, l'avancement CUMULÉ atteint, et le montant qui en découle. Le pied
 * fait le reste du chemin — situation précédente déduite, révision, TVA, retenue de garantie —
 * jusqu'au NET À PAYER, qui est le seul chiffre que le client regarde vraiment.
 */
@Injectable()
export class DocumentPdfService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /* ─────────── situation de travaux ─────────── */

  situationPdf(situationId: string): Promise<Buffer> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const [s] = await em.query(
        `SELECT s.*, s.date::text AS date_txt, m.code AS marche_code, m.name AS marche_nom,
                ch.code AS chantier_code, ch.name AS chantier_nom,
                cl.name AS client_nom, cl.address AS client_adresse
           FROM situation s
           JOIN marche m ON m.id = s.marche_id
           LEFT JOIN chantier ch ON ch.id = m.chantier_id
           LEFT JOIN devis_version dv ON dv.id = m.devis_version_id
           LEFT JOIN devis dv2 ON dv2.id = dv.devis_id
           LEFT JOIN affaire aff ON aff.id = dv2.affaire_id
           LEFT JOIN client cl ON cl.id = aff.client_id
          WHERE s.id = $1`,
        [situationId],
      );
      if (!s) throw new NotFoundException(`Situation introuvable (${situationId}).`);

      const lignes: LigneDocument[] = (await em.query(
        `SELECT ml.designation, ml.unit, ml.quantite, ml.pu,
                ml.montant_ht AS montant_marche, sl.pct_avancement AS pct,
                sl.cumul_ht AS cumul, false AS titre
           FROM situation_line sl
           JOIN marche_line ml ON ml.id = sl.marche_line_id
          WHERE sl.situation_id = $1
          ORDER BY ml.sort_order ASC`,
        [situationId],
      )) as LigneDocument[];

      // Ce qui a déjà été facturé : la situation ne réclame que la PÉRIODE.
      const [precedent] = await em.query(
        `SELECT COALESCE(SUM(cumul_ht), 0)::numeric(16,2) AS cumul
           FROM situation
          WHERE marche_id = $1 AND numero = $2 - 1`,
        [s.marche_id, s.numero],
      );

      const pied: PiedLigne[] = [
        { libelle: 'Travaux cumulés depuis l’origine (HT)', montant: s.cumul_ht },
        ...(Number(precedent?.cumul ?? 0) !== 0
          ? [{ libelle: 'Situation précédente', montant: precedent.cumul, deduction: true }]
          : []),
        { libelle: 'Montant de la période (HT)', montant: s.montant_periode_ht, fort: true },
        ...(Number(s.revision_coefficient) !== 1
          ? [{
            libelle: `Révision de prix (coefficient ${Number(s.revision_coefficient).toFixed(4)})`,
            montant: '0',
          }]
          : []),
        { libelle: `TVA ${(Number(s.tva_rate) * 100).toFixed(1)} %`, montant: s.tva },
        { libelle: 'Total TTC', montant: s.ttc, fort: true },
        ...(Number(s.retenue_garantie) !== 0
          ? [{
            libelle: `Retenue de garantie ${(Number(s.retenue_rate) * 100).toFixed(1)} %`,
            montant: s.retenue_garantie,
            deduction: true,
          }]
          : []),
        { libelle: 'NET À PAYER', montant: s.nap, fort: true },
      ];

      return this.dessiner(em, {
        titre: 'SITUATION DE TRAVAUX',
        references: [
          `Situation n° ${s.numero}`,
          `Marché ${s.marche_code}`,
          ...(s.chantier_code ? [`Chantier ${s.chantier_code}`] : []),
          `Date : ${new Date(s.date_txt ?? s.created_at).toLocaleDateString('fr-FR')}`,
        ],
        objet: `${s.marche_nom ?? ''}${s.chantier_nom ? ` — ${s.chantier_nom}` : ''}`,
        destinataire: { nom: s.client_nom, adresse: s.client_adresse },
        colonnes: ['Désignation', 'U', 'Marché HT', 'Avanc.', 'Cumul HT'],
        lignes,
        pied,
      });
    });
  }

  /* ─────────── facture ─────────── */

  facturePdf(invoiceId: string): Promise<Buffer> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const [f] = await em.query(
        `SELECT i.*, i.date::text AS date_txt,
                s.numero AS situation_numero, s.cumul_ht, s.montant_periode_ht,
                s.retenue_garantie, s.nap, s.tva_rate,
                m.code AS marche_code, m.name AS marche_nom,
                ch.code AS chantier_code, ch.name AS chantier_nom,
                cl.name AS client_nom, cl.address AS client_adresse
           FROM invoice i
           JOIN situation s ON s.id = i.situation_id
           JOIN marche m ON m.id = s.marche_id
           LEFT JOIN chantier ch ON ch.id = m.chantier_id
           LEFT JOIN devis_version dv ON dv.id = m.devis_version_id
           LEFT JOIN devis dv2 ON dv2.id = dv.devis_id
           LEFT JOIN affaire aff ON aff.id = dv2.affaire_id
           LEFT JOIN client cl ON cl.id = aff.client_id
          WHERE i.id = $1`,
        [invoiceId],
      );
      if (!f) throw new NotFoundException(`Facture introuvable (${invoiceId}).`);

      const lignes: LigneDocument[] = [{
        designation: `Travaux — situation n° ${f.situation_numero} du marché ${f.marche_code}`,
        unit: null, quantite: null, pu: null,
        montant_marche: null, pct: null, cumul: f.montant_ht, titre: false,
      }];

      const pied: PiedLigne[] = [
        { libelle: 'Total HT', montant: f.montant_ht, fort: true },
        { libelle: `TVA ${(Number(f.tva_rate ?? 0.2) * 100).toFixed(1)} %`, montant: f.tva },
        ...(Number(f.tpf ?? 0) !== 0 ? [{ libelle: 'Taxe pour frais de chambre', montant: f.tpf }] : []),
        { libelle: 'Total TTC', montant: f.ttc, fort: true },
        ...(Number(f.retenue_garantie ?? 0) !== 0
          ? [{ libelle: 'Retenue de garantie', montant: f.retenue_garantie, deduction: true }]
          : []),
        { libelle: 'NET À PAYER', montant: f.nap ?? f.ttc, fort: true },
      ];

      return this.dessiner(em, {
        titre: 'FACTURE',
        references: [
          `N° ${f.numero}`,
          `Date : ${new Date(f.date_txt).toLocaleDateString('fr-FR')}`,
          `Marché ${f.marche_code}`,
          ...(f.chantier_code ? [`Chantier ${f.chantier_code}`] : []),
        ],
        objet: `${f.marche_nom ?? ''}${f.chantier_nom ? ` — ${f.chantier_nom}` : ''}`,
        destinataire: { nom: f.client_nom, adresse: f.client_adresse },
        colonnes: ['Désignation', '', '', '', 'Montant HT'],
        lignes,
        pied,
        mentions: [
          'Paiement à 30 jours date de facture, sauf conditions particulières du marché.',
          'En cas de retard : pénalités au taux directeur BCE majoré de 10 points, et indemnité '
          + 'forfaitaire de recouvrement de 40 € (art. L441-10 et D441-5 du code de commerce).',
        ],
      });
    });
  }

  /* ─────────── décompte général définitif ─────────── */

  dgdPdf(dgdId: string): Promise<Buffer> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const [d] = await em.query(
        `SELECT d.*, m.code AS marche_code, m.name AS marche_nom,
                ch.code AS chantier_code, ch.name AS chantier_nom,
                cl.name AS client_nom, cl.address AS client_adresse
           FROM dgd d
           JOIN marche m ON m.id = d.marche_id
           LEFT JOIN chantier ch ON ch.id = m.chantier_id
           LEFT JOIN devis_version dv ON dv.id = m.devis_version_id
           LEFT JOIN devis dv2 ON dv2.id = dv.devis_id
           LEFT JOIN affaire aff ON aff.id = dv2.affaire_id
           LEFT JOIN client cl ON cl.id = aff.client_id
          WHERE d.id = $1`,
        [dgdId],
      );
      if (!d) throw new NotFoundException(`DGD introuvable (${dgdId}).`);

      const lignes: LigneDocument[] = [
        {
          designation: 'Montant du marché, avenants compris (HT)',
          unit: null, quantite: null, pu: null, montant_marche: null, pct: null,
          cumul: d.montant_marche_ht, titre: false,
        },
        {
          designation: 'Travaux exécutés, cumulés depuis l’origine (HT)',
          unit: null, quantite: null, pu: null, montant_marche: null, pct: null,
          cumul: d.travaux_cumul_ht, titre: false,
        },
      ];

      const pied: PiedLigne[] = [
        { libelle: 'Travaux cumulés (HT)', montant: d.travaux_cumul_ht, fort: true },
        { libelle: 'TVA', montant: d.tva },
        { libelle: 'Total TTC', montant: d.ttc, fort: true },
        { libelle: 'Retenue de garantie constituée', montant: d.retenue_garantie_totale, deduction: true },
        { libelle: 'Déjà réglé (situations)', montant: d.deja_regle_nap, deduction: true },
        { libelle: 'SOLDE À PAYER', montant: d.solde_nap, fort: true },
      ];

      return this.dessiner(em, {
        titre: 'DÉCOMPTE GÉNÉRAL DÉFINITIF',
        references: [
          `Marché ${d.marche_code}`,
          ...(d.chantier_code ? [`Chantier ${d.chantier_code}`] : []),
          `Établi le ${new Date(d.created_at).toLocaleDateString('fr-FR')}`,
        ],
        objet: `${d.marche_nom ?? ''}${d.chantier_nom ? ` — ${d.chantier_nom}` : ''}`,
        destinataire: { nom: d.client_nom, adresse: d.client_adresse },
        colonnes: ['Désignation', '', '', '', 'Montant HT'],
        lignes,
        pied,
        mentions: [
          'Le présent décompte général vaut solde du marché. À défaut de contestation motivée dans '
          + 'les délais prévus au marché, il devient définitif.',
        ],
      });
    });
  }

  /* ─────────── dessin commun ─────────── */

  private async dessiner(
    em: EntityManager,
    doc: {
      titre: string;
      references: string[];
      objet: string;
      destinataire: { nom: string | null; adresse: unknown };
      colonnes: string[];
      lignes: LigneDocument[];
      pied: PiedLigne[];
      mentions?: string[];
    },
  ): Promise<Buffer> {
    const societe: SocieteRow | null = (await em.query(
      `SELECT name, legal_form, address, postal_code, city, phone, email, siret, vat_intra,
              rcs, capital, logo_data
         FROM company ORDER BY code ASC LIMIT 1`,
    ))[0] ?? null;
    const prefs = (await em.query(
      `SELECT couleur_principale, couleur_accent, modele_pdf FROM company_preferences LIMIT 1`,
    ))[0] ?? null;

    const couleurs: CouleursSociete = {
      primary: prefs?.couleur_principale ?? '#1a3a5c',
      accent: prefs?.couleur_accent ?? '#e8550a',
    };
    const style = modelePdf(prefs?.modele_pdf);
    return this.rendre(style, couleurs, societe, doc);
  }

  private rendre(
    style: StyleModele,
    couleurs: CouleursSociete,
    societe: SocieteRow | null,
    data: {
      titre: string;
      references: string[];
      objet: string;
      destinataire: { nom: string | null; adresse: unknown };
      colonnes: string[];
      lignes: LigneDocument[];
      pied: PiedLigne[];
      mentions?: string[];
    },
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const M = style.marge;
      const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const LARGEUR = doc.page.width - M * 2;
      const DROITE = doc.page.width - M;
      const euro = (v: unknown) =>
        `${Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

      let y = dessinerEnTete(doc, style, couleurs, {
        titre: data.titre,
        references: data.references,
        societe: {
          nom: societe?.name ?? '',
          lignes: [
            societe?.address ?? '',
            [societe?.postal_code, societe?.city].filter(Boolean).join(' '),
            [societe?.phone && `Tél. ${societe.phone}`, societe?.email].filter(Boolean).join('  ·  '),
          ].filter((l) => l && String(l).trim()),
          logo: societe?.logo_data ? Buffer.from(societe.logo_data, 'base64') : null,
        },
      });

      /* Destinataire — à droite, à hauteur de fenêtre d'enveloppe. */
      if (data.destinataire.nom) {
        const largeurDest = 240;
        const x = DROITE - largeurDest;
        doc.font(style.police.corps).fontSize(style.tailles.petit).fillColor('#94a3b8')
          .text('DESTINATAIRE', x, y, { width: largeurDest });
        doc.font(style.police.titre).fontSize(style.tailles.corps + 1).fillColor('#0f172a')
          .text(data.destinataire.nom, x, doc.y + 2, { width: largeurDest });
        const a = (data.destinataire.adresse ?? {}) as Record<string, string>;
        doc.font(style.police.corps).fontSize(style.tailles.corps).fillColor('#334155');
        for (const l of [a.ligne1, [a.code_postal, a.ville].filter(Boolean).join(' ')]) {
          if (l && l.trim()) doc.text(l, x, doc.y, { width: largeurDest });
        }
        y = doc.y + 14;
      }

      /* Objet — ce que le document couvre, en une ligne. */
      if (data.objet.trim()) {
        doc.font(style.police.titre).fontSize(style.tailles.corps).fillColor('#0f172a')
          .text('Objet : ', M, y, { continued: true });
        doc.font(style.police.corps).fillColor('#334155').text(data.objet);
        y = doc.y + 12;
      }

      /* Corps */
      const colonnes = [
        { titre: data.colonnes[0], x: M, largeur: LARGEUR - 300 },
        { titre: data.colonnes[1], x: M + LARGEUR - 300, largeur: 40, alignement: 'center' as const },
        { titre: data.colonnes[2], x: M + LARGEUR - 260, largeur: 90, alignement: 'right' as const },
        { titre: data.colonnes[3], x: M + LARGEUR - 170, largeur: 60, alignement: 'right' as const },
        { titre: data.colonnes[4], x: M + LARGEUR - 110, largeur: 110, alignement: 'right' as const },
      ];
      y = dessinerEnteteTableau(doc, style, couleurs, colonnes, y);

      const nouvellePage = () => {
        doc.addPage();
        y = M;
        y = dessinerEnteteTableau(doc, style, couleurs, colonnes, y);
      };

      let index = 0;
      for (const l of data.lignes) {
        if (y > doc.page.height - 170) nouvellePage();
        fondLigne(doc, style, y, index);
        const gras = l.titre;
        doc.font(gras ? style.police.titre : style.police.corps).fontSize(style.tailles.tableau)
          .fillColor(gras ? couleurs.primary : '#0f172a');
        doc.text(l.designation, colonnes[0].x, y, { width: colonnes[0].largeur });
        const hauteur = Math.max(doc.y - y, style.hauteurLigne - 4);
        if (l.unit) doc.text(l.unit, colonnes[1].x, y, { width: colonnes[1].largeur, align: 'center' });
        if (l.montant_marche != null) {
          doc.text(euro(l.montant_marche), colonnes[2].x, y, { width: colonnes[2].largeur, align: 'right' });
        }
        if (l.pct != null) {
          doc.text(`${(Number(l.pct) * 100).toFixed(1)} %`, colonnes[3].x, y, {
            width: colonnes[3].largeur, align: 'right',
          });
        }
        doc.text(euro(l.cumul), colonnes[4].x, y, { width: colonnes[4].largeur, align: 'right' });
        y += hauteur + 4;
        if (style.tableau.filets) {
          doc.moveTo(M, y - 2).lineTo(DROITE, y - 2).lineWidth(0.3).strokeColor('#e2e8f0').stroke();
        }
        index += 1;
      }

      /* Pied — le chemin jusqu'au net à payer. */
      if (y > doc.page.height - 200) nouvellePage();
      y += 10;
      const largeurPied = 300;
      const xPied = DROITE - largeurPied;
      for (const p of data.pied) {
        const fort = Boolean(p.fort);
        doc.font(fort ? style.police.titre : style.police.corps)
          .fontSize(fort ? style.tailles.corps + 1 : style.tailles.corps)
          .fillColor(fort ? couleurs.primary : '#334155');
        doc.text(p.libelle, xPied, y, { width: largeurPied - 110 });
        doc.fillColor(p.deduction ? '#b91c1c' : fort ? couleurs.primary : '#0f172a')
          .text(`${p.deduction ? '− ' : ''}${euro(p.montant)}`, xPied + largeurPied - 110, y, {
            width: 110, align: 'right',
          });
        y = doc.y + 4;
        if (fort) {
          doc.moveTo(xPied, y).lineTo(DROITE, y).lineWidth(0.6).strokeColor(couleurs.accent).stroke();
          y += 4;
        }
      }

      /* Mentions légales et pied de page société. */
      if (data.mentions?.length) {
        y += 10;
        doc.font(style.police.italique).fontSize(style.tailles.petit - 0.5).fillColor('#64748b');
        for (const m of data.mentions) {
          doc.text(m, M, y, { width: LARGEUR });
          y = doc.y + 2;
        }
      }

      const pages = doc.bufferedPageRange();
      const identite = [
        societe?.legal_form,
        societe?.capital && `capital ${societe.capital}`,
        societe?.siret && `SIRET ${societe.siret}`,
        societe?.rcs && `RCS ${societe.rcs}`,
        societe?.vat_intra && `TVA ${societe.vat_intra}`,
      ].filter(Boolean).join(' · ');
      for (let i = 0; i < pages.count; i += 1) {
        doc.switchToPage(pages.start + i);
        doc.font(style.police.corps).fontSize(style.tailles.petit - 1).fillColor('#94a3b8')
          .text(identite, M, doc.page.height - M + 6, { width: LARGEUR - 60 })
          .text(`${i + 1} / ${pages.count}`, DROITE - 60, doc.page.height - M + 6, {
            width: 60, align: 'right',
          });
      }

      doc.end();
    });
  }
}
