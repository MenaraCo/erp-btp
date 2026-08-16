import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import PDFDocument from 'pdfkit';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

const M = 40;
const RIGHT = 595.28 - M;

const MOTIFS: Record<string, string> = {
  conges: 'Congés payés', rtt: 'RTT', maladie: 'Arrêt maladie',
  accident: 'Accident du travail', intemperie: 'Intempéries', formation: 'Formation',
  ferie: 'Jour férié', sans_solde: 'Congé sans solde', autre: 'Autre absence',
};

const euro = (v: unknown) =>
  `${Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const nb = (v: unknown) => Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

/**
 * Relevé mensuel en PDF — le document qu'on remet au salarié et qu'on fait signer.
 *
 * Il porte exactement ce que porte l'écran : heures par chantier, absences, éléments variables.
 * Un document qui dirait autre chose que l'application ne servirait qu'à créer des litiges.
 *
 * Le cadre de signature est toujours imprimé. Signé dans l'application, il montre le nom, la date
 * et le tracé manuscrit ; non signé, il laisse la place pour signer à la main — un relevé se
 * signe parfois sur le capot d'une camionnette, sans réseau.
 */
@Injectable()
export class RelevePdfService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  generer(employeeId: string, mois: string): Promise<Buffer> {
    const tenantId = this.context.requireTenantId();
    const debut = `${mois}-01`;
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const salarie = (await em.query(
        `SELECT code, first_name, last_name, job_title, qualification, contract_type, hourly_cost
           FROM employee WHERE id = $1`, [employeeId],
      ))[0];
      if (!salarie) throw new NotFoundException('Salarié introuvable.');

      const entete = (await em.query(
        `SELECT statut, heures_travaillees, jours_travailles, heures_absence, montant_rubriques,
                signe_par, signe_le, signature_image
           FROM payroll_releve WHERE employee_id = $1 AND mois = $2::date`,
        [employeeId, debut],
      ))[0] ?? null;

      const chantiers = await em.query(
        `SELECT c.code, c.name, SUM(t.hours)::numeric(10,2) AS heures,
                COUNT(DISTINCT t.work_date)::int AS jours
           FROM timesheet t JOIN chantier c ON c.id = t.chantier_id
          WHERE t.employee_id = $1
            AND t.work_date >= $2::date AND t.work_date < ($2::date + INTERVAL '1 month')
          GROUP BY c.code, c.name ORDER BY SUM(t.hours) DESC`,
        [employeeId, debut],
      );
      const absences = await em.query(
        `SELECT kind, SUM(hours)::numeric(10,2) AS heures, COUNT(*)::int AS jours
           FROM absence
          WHERE employee_id = $1
            AND work_date >= $2::date AND work_date < ($2::date + INTERVAL '1 month')
          GROUP BY kind ORDER BY kind`,
        [employeeId, debut],
      );
      const lignes = await em.query(
        `SELECT r.code, r.label, r.unite, l.quantite, l.montant_unitaire, l.montant,
                c.code AS chantier, ac.code AS poste
           FROM payroll_line l
           JOIN payroll_rubrique r ON r.id = l.rubrique_id
           LEFT JOIN chantier c ON c.id = l.chantier_id
           LEFT JOIN analytical_code ac ON ac.id = l.code_analytique_id
          WHERE l.employee_id = $1 AND l.mois = $2::date
          ORDER BY r.sort_order, r.code`,
        [employeeId, debut],
      );
      const company = (await em.query(
        `SELECT name FROM company ORDER BY code ASC LIMIT 1`,
      ))[0] ?? null;

      return this.dessiner({ salarie, entete, chantiers, absences, lignes, company, mois, em });
    });
  }

  private async dessiner(d: {
    salarie: Record<string, unknown>;
    entete: Record<string, unknown> | null;
    chantiers: Array<Record<string, unknown>>;
    absences: Array<Record<string, unknown>>;
    lignes: Array<Record<string, unknown>>;
    company: Record<string, unknown> | null;
    mois: string;
    em: EntityManager;
  }): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: M });
    const morceaux: Buffer[] = [];
    doc.on('data', (c: Buffer) => morceaux.push(c));
    const fini = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(morceaux)));
    });

    const [annee, m] = d.mois.split('-').map(Number);
    const libelleMois = new Date(annee, m - 1, 1)
      .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a')
      .text('Relevé mensuel d’heures', M, M);
    doc.fontSize(9).font('Helvetica').fillColor('#475569');
    doc.text(String(d.company?.name ?? ''));
    doc.text(`Période : ${libelleMois}`);
    doc.moveDown(0.6);

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a')
      .text(`${d.salarie.last_name} ${d.salarie.first_name ?? ''}`.trim());
    doc.fontSize(9).font('Helvetica').fillColor('#475569');
    const identite = [
      `Matricule ${d.salarie.code}`,
      d.salarie.job_title ? String(d.salarie.job_title) : null,
      d.salarie.qualification ? `Qualification ${d.salarie.qualification}` : null,
    ].filter(Boolean).join(' · ');
    doc.text(identite);
    doc.moveDown(0.8);

    // --- Totaux du mois : la première chose qu'on vérifie ---
    const e = d.entete;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('Totaux du mois');
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor('#334155');
    doc.text(`Heures travaillées : ${nb(e?.heures_travaillees)} h   ·   `
      + `Jours travaillés : ${nb(e?.jours_travailles)}   ·   `
      + `Heures d’absence : ${nb(e?.heures_absence)} h`);
    doc.text(`Éléments variables : ${euro(e?.montant_rubriques)}`);
    doc.moveDown(0.8);

    const tableau = (
      titre: string,
      colonnes: Array<{ t: string; x: number; w: number; align?: 'right' }>,
      donnees: Array<Array<string>>,
      vide: string,
    ) => {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text(titre, M, doc.y);
      doc.moveDown(0.3);
      if (donnees.length === 0) {
        doc.fontSize(9).font('Helvetica').fillColor('#64748b').text(vide);
        doc.moveDown(0.6);
        return;
      }
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#475569');
      const yTete = doc.y;
      colonnes.forEach((c) => doc.text(c.t, c.x, yTete, { width: c.w, align: c.align }));
      doc.y = yTete + 12;
      doc.moveTo(M, doc.y - 2).lineTo(RIGHT, doc.y - 2).strokeColor('#cbd5e1').stroke();
      doc.font('Helvetica').fillColor('#0f172a');
      for (const ligne of donnees) {
        if (doc.y > 690) doc.addPage();
        const y = doc.y;
        colonnes.forEach((c, i) => doc.text(ligne[i] ?? '', c.x, y, { width: c.w, align: c.align }));
        doc.y = y + 12;
      }
      doc.moveDown(0.6);
    };

    tableau(
      'Heures par chantier',
      [
        { t: 'Chantier', x: M, w: 300 },
        { t: 'Jours', x: M + 320, w: 60, align: 'right' },
        { t: 'Heures', x: M + 400, w: 80, align: 'right' },
      ],
      d.chantiers.map((c) => [
        `${c.code} ${c.name ?? ''}`.trim(), String(c.jours ?? 0), `${nb(c.heures)} h`,
      ]),
      'Aucune heure pointée sur ce mois.',
    );

    tableau(
      'Absences',
      [
        { t: 'Motif', x: M, w: 300 },
        { t: 'Jours', x: M + 320, w: 60, align: 'right' },
        { t: 'Heures', x: M + 400, w: 80, align: 'right' },
      ],
      d.absences.map((a) => [
        MOTIFS[String(a.kind)] ?? String(a.kind), String(a.jours ?? 0), `${nb(a.heures)} h`,
      ]),
      'Aucune absence sur ce mois.',
    );

    tableau(
      'Éléments variables',
      [
        { t: 'Code', x: M, w: 50 },
        { t: 'Libellé', x: M + 55, w: 150 },
        { t: 'Chantier', x: M + 210, w: 90 },
        { t: 'Qté', x: M + 305, w: 45, align: 'right' },
        { t: 'PU', x: M + 355, w: 60, align: 'right' },
        { t: 'Montant', x: M + 420, w: 75, align: 'right' },
      ],
      d.lignes.map((l) => [
        String(l.code), String(l.label), String(l.chantier ?? '—'),
        nb(l.quantite), euro(l.montant_unitaire), euro(l.montant),
      ]),
      'Aucun élément variable : le mois n’a pas encore été calculé.',
    );

    // --- Cadre de signature ---
    if (doc.y > 620) doc.addPage();
    const yCadre = Math.max(doc.y + 10, 600);
    doc.rect(M, yCadre, RIGHT - M, 130).strokeColor('#cbd5e1').stroke();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#475569')
      .text('Signature du salarié', M + 12, yCadre + 10);
    doc.font('Helvetica').fillColor('#64748b').fontSize(8)
      .text('Je reconnais l’exactitude des heures et des éléments variables ci-dessus.',
        M + 12, yCadre + 24, { width: 260 });

    const image = d.entete?.signature_image as string | null | undefined;
    if (image) {
      try {
        const base64 = image.split(',')[1] ?? '';
        doc.image(Buffer.from(base64, 'base64'), M + 12, yCadre + 45, { fit: [200, 60] });
      } catch {
        // Une signature illisible ne doit pas empêcher d'imprimer le relevé : le cadre reste vide,
        // le nom et la date en dessous font foi.
      }
    }
    if (d.entete?.signe_par) {
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f172a')
        .text(String(d.entete.signe_par), M + 12, yCadre + 110);
      doc.font('Helvetica').fillColor('#475569').text(
        `Signé le ${new Date(String(d.entete.signe_le)).toLocaleDateString('fr-FR')}`,
        M + 150, yCadre + 110,
      );
    }

    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#475569')
      .text('Visa de l’entreprise', M + 300, yCadre + 10);

    doc.end();
    return fini;
  }
}
