import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export interface FiltrePersonnel {
  debut: string;
  fin: string;
  employeeId?: string | null;
  chantierId?: string | null;
  contractType?: string | null;
}

export interface OccupationJour {
  date: string;
  chantiers: Array<{ chantierId: string; code: string; nom: string; heures: string; prevu: boolean }>;
  totalHeures: string;
  /** Journée à regarder : cumul anormal, ou présence sur plusieurs chantiers. */
  conflits: string[];
}

export interface LignePersonnel {
  employeeId: string;
  label: string;
  contractType: string;
  agency: string | null;
  codeAnalytique: string | null;
  jours: Record<string, OccupationJour>;
  totalHeures: string;
  totalPrevu: string;
  conflits: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Au-delà, une journée d'homme n'est plus crédible : c'est une double saisie ou une erreur. */
const SEUIL_JOURNEE = 12;

/**
 * Vue d'entreprise du personnel : qui travaille où, quand, et ce qui cloche.
 *
 * Le pointage se saisit chantier par chantier, mais un salarié n'appartient pas à un chantier :
 * il se répartit entre plusieurs. Sans vue globale, personne ne voit qu'un maçon a été pointé le
 * même jour sur deux chantiers — chacun ayant raison de son côté, et l'entreprise payant deux
 * fois la même journée dans ses résultats.
 */
@Injectable()
export class PersonnelService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /**
   * Occupation du personnel sur une période, tous chantiers confondus.
   * Les filtres servent à répondre à « où est Untel cette semaine ? » comme à « qui est sur ce
   * chantier ? » sans changer d'écran.
   */
  occupation(filtre: FiltrePersonnel) {
    const tenantId = this.context.requireTenantId();
    const { debut, fin } = bornes(filtre.debut, filtre.fin);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const params: unknown[] = [debut, fin];
      const conditions: string[] = [];
      if (filtre.employeeId) { params.push(filtre.employeeId); conditions.push(`e.id = $${params.length}`); }
      if (filtre.chantierId) { params.push(filtre.chantierId); conditions.push(`c.id = $${params.length}`); }
      if (filtre.contractType) { params.push(filtre.contractType); conditions.push(`e.contract_type = $${params.length}`); }
      const filtres = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

      // Réalisé et prévisionnel dans une seule lecture : le calendrier les montre côte à côte.
      const lignes: Array<{
        employee_id: string; label: string; contract_type: string; agency: string | null;
        code_analytique: string | null; chantier_id: string; chantier_code: string;
        chantier_nom: string; work_date: string; heures: string; prevu: boolean;
      }> = await em.query(
        `SELECT e.id AS employee_id,
                trim(coalesce(e.first_name, '') || ' ' || e.last_name) AS label,
                e.contract_type, e.agency, a.code AS code_analytique,
                c.id AS chantier_id, c.code AS chantier_code, c.name AS chantier_nom,
                t.work_date::text AS work_date, SUM(t.hours)::text AS heures, false AS prevu
           FROM timesheet t
           JOIN employee e ON e.id = t.employee_id
           JOIN chantier c ON c.id = t.chantier_id
           LEFT JOIN analytical_code a ON a.id = e.code_analytique_id
          WHERE t.work_date BETWEEN $1 AND $2 ${filtres}
          GROUP BY e.id, label, e.contract_type, e.agency, a.code, c.id, c.code, c.name, t.work_date
         UNION ALL
         SELECT e.id, trim(coalesce(e.first_name, '') || ' ' || e.last_name),
                e.contract_type, e.agency, a.code,
                c.id, c.code, c.name, f.work_date::text, SUM(f.hours)::text, true
           FROM timesheet_forecast f
           JOIN employee e ON e.id = f.employee_id
           JOIN chantier c ON c.id = f.chantier_id
           LEFT JOIN analytical_code a ON a.id = e.code_analytique_id
          WHERE f.work_date BETWEEN $1 AND $2 ${filtres}
          GROUP BY e.id, e.first_name, e.last_name, e.contract_type, e.agency, a.code,
                   c.id, c.code, c.name, f.work_date`,
        params,
      );

      const parSalarie = new Map<string, LignePersonnel>();
      for (const l of lignes) {
        const s = parSalarie.get(l.employee_id) ?? {
          employeeId: l.employee_id,
          label: l.label,
          contractType: l.contract_type,
          agency: l.agency,
          codeAnalytique: l.code_analytique,
          jours: {} as Record<string, OccupationJour>,
          totalHeures: '0',
          totalPrevu: '0',
          conflits: 0,
        };
        s.jours[l.work_date] ??= { date: l.work_date, chantiers: [], totalHeures: '0', conflits: [] };
        const jour = s.jours[l.work_date];
        jour.chantiers.push({
          chantierId: l.chantier_id,
          code: l.chantier_code,
          nom: l.chantier_nom,
          heures: new Decimal(l.heures).toString(),
          prevu: l.prevu,
        });
        if (l.prevu) {
          s.totalPrevu = new Decimal(s.totalPrevu).plus(l.heures).toString();
        } else {
          jour.totalHeures = new Decimal(jour.totalHeures).plus(l.heures).toString();
          s.totalHeures = new Decimal(s.totalHeures).plus(l.heures).toString();
        }
        parSalarie.set(l.employee_id, s);
      }

      // Conflits : c'est ici que la vue globale gagne sa place.
      for (const s of parSalarie.values()) {
        for (const jour of Object.values(s.jours)) {
          const reels = jour.chantiers.filter((c) => !c.prevu);
          const chantiersDistincts = new Set(reels.map((c) => c.chantierId));
          if (chantiersDistincts.size > 1) {
            jour.conflits.push(
              `Pointé sur ${chantiersDistincts.size} chantiers le même jour : ${reels.map((c) => c.code).join(', ')}`,
            );
          }
          if (new Decimal(jour.totalHeures).greaterThan(SEUIL_JOURNEE)) {
            jour.conflits.push(`${jour.totalHeures} h cumulées — journée impossible`);
          }
          s.conflits += jour.conflits.length;
        }
      }

      const salaries = [...parSalarie.values()].sort((a, b) => a.label.localeCompare(b.label));
      return {
        debut,
        fin,
        jours: joursEntre(debut, fin),
        salaries,
        totalHeures: salaries.reduce((t, s) => t.plus(s.totalHeures), new Decimal(0)).toString(),
        totalPrevu: salaries.reduce((t, s) => t.plus(s.totalPrevu), new Decimal(0)).toString(),
        conflits: salaries.reduce((n, s) => n + s.conflits, 0),
      };
    });
  }

  /**
   * Les seuls conflits, à plat — pour une page d'alerte qui va droit au but.
   * Un conflit n'est jamais bloqué à la saisie : un salarié PEUT légitimement passer d'un chantier
   * à l'autre dans la journée. On le signale, le conducteur tranche.
   */
  async conflits(debut: string, fin: string) {
    const vue = await this.occupation({ debut, fin });
    const liste = vue.salaries.flatMap((s) =>
      Object.values(s.jours)
        .filter((j) => j.conflits.length > 0)
        .map((j) => ({
          employeeId: s.employeeId,
          label: s.label,
          date: j.date,
          totalHeures: j.totalHeures,
          chantiers: j.chantiers.filter((c) => !c.prevu),
          motifs: j.conflits,
        })),
    );
    return { debut: vue.debut, fin: vue.fin, conflits: liste, total: liste.length };
  }
}

function joursEntre(debut: string, fin: string): string[] {
  const jours: string[] = [];
  const d = new Date(`${debut}T00:00:00Z`);
  const f = new Date(`${fin}T00:00:00Z`);
  for (let c = d; c <= f; c.setUTCDate(c.getUTCDate() + 1)) jours.push(c.toISOString().slice(0, 10));
  return jours;
}

function bornes(debut: string, fin: string): { debut: string; fin: string } {
  if (!ISO.test(debut ?? '') || !ISO.test(fin ?? '')) {
    throw new BadRequestException('Période attendue au format AAAA-MM-JJ.');
  }
  if (debut > fin) throw new BadRequestException('La date de début doit précéder la date de fin.');
  if (joursEntre(debut, fin).length > 62) {
    throw new BadRequestException('Période trop longue : deux mois au maximum.');
  }
  return { debut, fin };
}
