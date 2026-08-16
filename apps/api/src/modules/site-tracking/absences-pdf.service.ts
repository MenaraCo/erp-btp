import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import PDFDocument from 'pdfkit';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

const M = 40;
const RIGHT = 595.28 - M;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Libellés des motifs — les mêmes qu'à l'écran, sinon le papier dirait autre chose. */
const MOTIFS: Record<string, string> = {
  conges: 'Congés payés',
  rtt: 'RTT',
  maladie: 'Arrêt maladie',
  accident: 'Accident du travail',
  intemperie: 'Intempéries',
  formation: 'Formation',
  ferie: 'Jour férié',
  sans_solde: 'Congé sans solde',
  autre: 'Autre absence',
};

const jour = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR');

/**
 * Relevé d'absences en PDF — le document qu'on classe, qu'on affiche à l'atelier ou qu'on
 * transmet à la paye.
 *
 * Il porte le récapitulatif AVANT le détail : la question posée à ce papier est « combien de
 * jours, et de quel type ? », le détail jour par jour ne sert qu'à la vérification. La période
 * et les filtres appliqués sont écrits en toutes lettres, sans quoi deux relevés du même mois
 * pourraient afficher des totaux différents sans qu'on sache pourquoi.
 */
@Injectable()
export class AbsencesPdfService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  releve(
    debut: string, fin: string, employeeId?: string | null, motif?: string | null,
  ): Promise<Buffer> {
    const tenantId = this.context.requireTenantId();
    if (!ISO.test(debut ?? '') || !ISO.test(fin ?? '')) {
      throw new BadRequestException('Période attendue au format AAAA-MM-JJ.');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [debut, fin];
      let filtre = '';
      if (employeeId) { params.push(employeeId); filtre = `AND a.employee_id = $${params.length}`; }
      if (motif) { params.push(motif); filtre += ` AND a.kind = $${params.length}`; }

      const lignes = await em.query(
        `SELECT a.work_date::text AS date, a.kind, a.hours::text AS heures, a.comment,
                e.code AS matricule,
                trim(coalesce(e.first_name,'') || ' ' || e.last_name) AS salarie
           FROM absence a
           JOIN employee e ON e.id = a.employee_id
          WHERE a.work_date BETWEEN $1 AND $2 ${filtre}
          ORDER BY salarie, a.work_date`,
        params,
      );
      const company = (await em.query(
        `SELECT name FROM company ORDER BY code ASC LIMIT 1`,
      ))[0] ?? null;

      const doc = new PDFDocument({ size: 'A4', margin: M });
      const morceaux: Buffer[] = [];
      doc.on('data', (c: Buffer) => morceaux.push(c));
      const fini = new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(morceaux)));
      });

      doc.fontSize(16).font('Helvetica-Bold').text('Relevé d’absences', M, M);
      doc.fontSize(9).font('Helvetica').fillColor('#475569');
      doc.text(company?.name ?? '', { align: 'left' });
      doc.text(`Période du ${jour(debut)} au ${jour(fin)}`);
      if (employeeId && lignes.length > 0) doc.text(`Salarié : ${lignes[0].salarie}`);
      if (motif) doc.text(`Motif : ${MOTIFS[motif] ?? motif}`);
      doc.moveDown(0.6);

      // --- Récapitulatif par salarié et par motif ---
      const parSalarie = new Map<string, Map<string, { jours: number; heures: number }>>();
      for (const l of lignes) {
        const cle = `${l.matricule ?? ''} ${l.salarie}`.trim();
        const motifs = parSalarie.get(cle) ?? new Map();
        const cumul = motifs.get(l.kind) ?? { jours: 0, heures: 0 };
        motifs.set(l.kind, { jours: cumul.jours + 1, heures: cumul.heures + Number(l.heures ?? 0) });
        parSalarie.set(cle, motifs);
      }

      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text('Récapitulatif');
      doc.moveDown(0.3);
      doc.fontSize(9);
      if (parSalarie.size === 0) {
        doc.font('Helvetica').fillColor('#475569')
          .text('Aucune absence sur cette période — le relevé le dit plutôt que de rester vide.');
      }
      for (const [salarie, motifs] of parSalarie) {
        doc.font('Helvetica-Bold').fillColor('#0f172a').text(salarie);
        doc.font('Helvetica').fillColor('#334155');
        let joursTotal = 0;
        let heuresTotal = 0;
        for (const [kind, cumul] of motifs) {
          joursTotal += cumul.jours;
          heuresTotal += cumul.heures;
          doc.text(
            `    ${MOTIFS[kind] ?? kind} : ${cumul.jours} jour(s) — ${cumul.heures} h`,
          );
        }
        doc.font('Helvetica-Bold').fillColor('#0f172a')
          .text(`    Total : ${joursTotal} jour(s) — ${heuresTotal} h`);
        doc.moveDown(0.4);
      }

      // --- Détail jour par jour ---
      if (lignes.length > 0) {
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Détail');
        doc.moveDown(0.3);
        doc.fontSize(8.5);
        const cols = [M, M + 150, M + 240, M + 330, M + 380];
        const entete = () => {
          doc.font('Helvetica-Bold').fillColor('#475569');
          doc.text('Salarié', cols[0], doc.y, { width: 145, continued: false });
          const y = doc.y - 11;
          doc.text('Date', cols[1], y, { width: 85 });
          doc.text('Motif', cols[2], y, { width: 85 });
          doc.text('Heures', cols[3], y, { width: 45, align: 'right' });
          doc.text('Commentaire', cols[4], y, { width: RIGHT - cols[4] });
          doc.moveTo(M, doc.y + 2).lineTo(RIGHT, doc.y + 2).strokeColor('#cbd5e1').stroke();
          doc.moveDown(0.4);
        };
        entete();
        doc.font('Helvetica').fillColor('#0f172a');
        for (const l of lignes) {
          // Nouvelle page quand la ligne ne tient plus : sans ce contrôle, pdfkit pagine seul et
          // la nouvelle page arrive sans en-tête de colonnes.
          if (doc.y > 740) {
            doc.addPage();
            doc.fontSize(8.5);
            entete();
            doc.font('Helvetica').fillColor('#0f172a');
          }
          const y = doc.y;
          doc.text(`${l.matricule ?? ''} ${l.salarie}`.trim(), cols[0], y, { width: 145 });
          doc.text(jour(l.date), cols[1], y, { width: 85 });
          doc.text(MOTIFS[l.kind] ?? l.kind, cols[2], y, { width: 85 });
          doc.text(String(Number(l.heures ?? 0)), cols[3], y, { width: 45, align: 'right' });
          doc.text(l.comment ?? '', cols[4], y, { width: RIGHT - cols[4] });
          doc.moveDown(0.25);
        }
      }

      doc.end();
      return fini;
    });
  }
}
