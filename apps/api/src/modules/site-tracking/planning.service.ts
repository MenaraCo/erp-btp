import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { returningRows } from '../../core/database/returning.util';

export interface CelluleJour {
  /** Heures réellement pointées ce jour-là (somme des lignes, un ouvrage pouvant en avoir plusieurs). */
  realise: string;
  /** Heures planifiées. Une prévision ne coûte rien : elle n'entre dans aucun résultat. */
  prevu: string;
  /** Le réalisé du jour est-il arrêté ? Une cellule figée ne se saisit plus. */
  impute: boolean;
  /** Plusieurs lignes de réalisé ce jour : la grille ne peut pas les résumer sans choisir. */
  multiple: boolean;
}

export interface LigneCalendrier {
  employeeId: string | null;
  label: string;
  contractType: string | null;
  agency: string | null;
  jours: Record<string, CelluleJour>;
  totalRealise: string;
  totalPrevu: string;
}

export interface DuplicationInput {
  employeeId: string;
  hours: string | number;
  debut: string;
  fin: string;
  /** Ne remplir que du lundi au vendredi — le cas courant sur un chantier. */
  joursOuvres?: boolean;
  /** Ne pas écraser une valeur déjà saisie ce jour-là. */
  conserverExistant?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Calendrier des heures : ce qui a été fait, et ce qui est prévu.
 *
 * Deux besoins que la saisie ligne à ligne servait mal. D'abord VOIR : un mois de pointages en
 * liste ne dit pas qui a travaillé quel jour, ni où sont les trous. Ensuite ALLER VITE : sur un
 * chantier, la même équipe fait souvent les mêmes journées toute la semaine — la retaper jour
 * après jour est une perte de temps qui décourage la saisie, et un pointage non saisi vaut un
 * résultat faux.
 *
 * Le prévisionnel est stocké à part (`timesheet_forecast`) : il ne pèse dans aucun résultat tant
 * qu'il n'a pas eu lieu.
 */
@Injectable()
export class PlanningService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Grille salarié × jour sur une période, réalisé et prévu côte à côte. */
  calendrier(chantierId: string, debut: string, fin: string) {
    const tenantId = this.context.requireTenantId();
    const { debut: d, fin: f } = bornes(debut, fin);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const realise: Array<{
        employee_id: string | null; employee_label: string; work_date: string;
        hours: string; lignes: string; imputes: string;
      }> = await em.query(
        `SELECT employee_id, employee_label, work_date::text AS work_date,
                SUM(hours)::text AS hours, count(*)::text AS lignes,
                count(*) FILTER (WHERE imputed_at IS NOT NULL)::text AS imputes
           FROM timesheet
          WHERE chantier_id = $1 AND work_date BETWEEN $2 AND $3
          GROUP BY employee_id, employee_label, work_date`,
        [chantierId, d, f],
      );

      const prevu: Array<{ employee_id: string; work_date: string; hours: string }> =
        await em.query(
          `SELECT employee_id, work_date::text AS work_date, hours::text AS hours
             FROM timesheet_forecast
            WHERE chantier_id = $1 AND work_date BETWEEN $2 AND $3`,
          [chantierId, d, f],
        );

      const fiches: Array<{
        id: string; first_name: string | null; last_name: string;
        contract_type: string; agency: string | null;
      }> = await em.query(
        `SELECT id, first_name, last_name, contract_type, agency
           FROM employee WHERE deleted_at IS NULL`,
      );
      const parId = new Map(fiches.map((e) => [e.id, e]));

      const lignes = new Map<string, LigneCalendrier>();
      const obtenir = (id: string | null, label: string): LigneCalendrier => {
        const cle = id ?? `libre:${label}`;
        const fiche = id ? parId.get(id) : undefined;
        const existante = lignes.get(cle);
        if (existante) return existante;
        const creee: LigneCalendrier = {
          employeeId: id,
          label: fiche ? [fiche.first_name, fiche.last_name].filter(Boolean).join(' ') : label,
          contractType: fiche?.contract_type ?? null,
          agency: fiche?.agency ?? null,
          jours: {},
          totalRealise: '0',
          totalPrevu: '0',
        };
        lignes.set(cle, creee);
        return creee;
      };
      const cellule = (l: LigneCalendrier, jour: string): CelluleJour => {
        l.jours[jour] ??= { realise: '0', prevu: '0', impute: false, multiple: false };
        return l.jours[jour];
      };

      for (const r of realise) {
        const l = obtenir(r.employee_id, r.employee_label);
        const c = cellule(l, r.work_date);
        c.realise = new Decimal(r.hours).toString();
        c.impute = Number(r.imputes) > 0;
        c.multiple = Number(r.lignes) > 1;
        l.totalRealise = new Decimal(l.totalRealise).plus(r.hours).toString();
      }
      for (const p of prevu) {
        const fiche = parId.get(p.employee_id);
        const l = obtenir(p.employee_id, fiche ? `${fiche.first_name ?? ''} ${fiche.last_name}`.trim() : '—');
        const c = cellule(l, p.work_date);
        c.prevu = new Decimal(p.hours).toString();
        l.totalPrevu = new Decimal(l.totalPrevu).plus(p.hours).toString();
      }

      const salaries = [...lignes.values()].sort((a, b) => a.label.localeCompare(b.label));
      return {
        debut: d,
        fin: f,
        jours: joursEntre(d, f),
        salaries,
        totalRealise: salaries.reduce((s, l) => s.plus(l.totalRealise), new Decimal(0)).toString(),
        totalPrevu: salaries.reduce((s, l) => s.plus(l.totalPrevu), new Decimal(0)).toString(),
      };
    });
  }

  /**
   * Écrit une cellule de PRÉVISIONNEL. `hours = 0` efface la prévision : sur un planning, vider
   * une case doit être aussi simple que la remplir.
   */
  planifier(chantierId: string, employeeId: string, date: string, hours: string | number) {
    const tenantId = this.context.requireTenantId();
    if (!ISO_DATE.test(date)) throw new BadRequestException('Date attendue au format AAAA-MM-JJ.');
    const h = new Decimal(hours ?? 0);
    if (h.isNegative()) throw new BadRequestException('Les heures ne peuvent pas être négatives.');

    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertSalarie(em, employeeId);
      if (h.isZero()) {
        await em.query(
          `DELETE FROM timesheet_forecast
            WHERE chantier_id = $1 AND employee_id = $2 AND work_date = $3`,
          [chantierId, employeeId, date],
        );
        return { employeeId, date, hours: '0' };
      }
      const rows = await em.query(
        `INSERT INTO timesheet_forecast (tenant_id, chantier_id, employee_id, work_date, hours)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (chantier_id, employee_id, work_date)
         DO UPDATE SET hours = EXCLUDED.hours, updated_at = now()
         RETURNING employee_id, work_date::text AS work_date, hours::text AS hours`,
        [tenantId, chantierId, employeeId, date, h.toString()],
      );
      return { employeeId: rows[0].employee_id, date: rows[0].work_date, hours: rows[0].hours };
    });
  }

  /**
   * Duplique une même journée sur une période — l'outil qui fait gagner le plus de temps.
   * Par défaut, jours ouvrés seulement : une équipe ne travaille pas le dimanche.
   */
  dupliquerPrevisionnel(chantierId: string, input: DuplicationInput) {
    const tenantId = this.context.requireTenantId();
    const { debut, fin } = bornes(input.debut, input.fin);
    const h = new Decimal(input.hours ?? 0);
    if (h.isNegative()) throw new BadRequestException('Les heures ne peuvent pas être négatives.');

    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertSalarie(em, input.employeeId);
      const jours = joursEntre(debut, fin).filter(
        (j) => !input.joursOuvres || estOuvre(j),
      );
      let ecrits = 0;
      for (const jour of jours) {
        if (input.conserverExistant) {
          const deja = await em.query(
            `SELECT 1 FROM timesheet_forecast
              WHERE chantier_id = $1 AND employee_id = $2 AND work_date = $3`,
            [chantierId, input.employeeId, jour],
          );
          if (deja.length > 0) continue;
        }
        if (h.isZero()) {
          await em.query(
            `DELETE FROM timesheet_forecast
              WHERE chantier_id = $1 AND employee_id = $2 AND work_date = $3`,
            [chantierId, input.employeeId, jour],
          );
        } else {
          await em.query(
            `INSERT INTO timesheet_forecast (tenant_id, chantier_id, employee_id, work_date, hours)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (chantier_id, employee_id, work_date)
             DO UPDATE SET hours = EXCLUDED.hours, updated_at = now()`,
            [tenantId, chantierId, input.employeeId, jour, h.toString()],
          );
        }
        ecrits += 1;
      }
      return { jours: ecrits, debut, fin };
    });
  }

  /**
   * Reporte le prévisionnel d'une période en heures RÉELLES.
   *
   * C'est le geste de fin de semaine : « la semaine s'est passée comme prévu ». On ne touche
   * jamais à un jour déjà pointé — le réel saisi prime toujours sur le plan.
   */
  reporterEnRealise(chantierId: string, debut: string, fin: string) {
    const tenantId = this.context.requireTenantId();
    const { debut: d, fin: f } = bornes(debut, fin);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const prevus: Array<{ employee_id: string; work_date: string; hours: string }> =
        await em.query(
          `SELECT f.employee_id, f.work_date::text AS work_date, f.hours::text AS hours
             FROM timesheet_forecast f
            WHERE f.chantier_id = $1 AND f.work_date BETWEEN $2 AND $3
              AND NOT EXISTS (
                SELECT 1 FROM timesheet t
                 WHERE t.chantier_id = f.chantier_id
                   AND t.employee_id = f.employee_id
                   AND t.work_date = f.work_date
              )`,
          [chantierId, d, f],
        );

      let crees = 0;
      for (const p of prevus) {
        const fiche = (
          await em.query(
            `SELECT first_name, last_name, hourly_cost, code_analytique_id FROM employee WHERE id = $1`,
            [p.employee_id],
          )
        )[0];
        if (!fiche) continue;
        const heures = new Decimal(p.hours);
        const cout = heures.times(fiche.hourly_cost).toDecimalPlaces(2);
        await em.query(
          `INSERT INTO timesheet
             (tenant_id, chantier_id, employee_id, employee_label, work_date, hours, hourly_cost,
              cost, code_analytique_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            tenantId,
            chantierId,
            p.employee_id,
            [fiche.first_name, fiche.last_name].filter(Boolean).join(' '),
            p.work_date,
            heures.toString(),
            String(fiche.hourly_cost),
            cout.toString(),
            fiche.code_analytique_id ?? null,
          ],
        );
        crees += 1;
      }
      return { crees, ignores: prevus.length - crees, debut: d, fin: f };
    });
  }

  /**
   * Écrit une cellule de RÉALISÉ depuis la grille.
   *
   * La grille résume une journée par un seul nombre. Quand ce jour compte déjà plusieurs lignes
   * (heures ventilées sur plusieurs ouvrages), on refuse plutôt que de choisir à la place de
   * l'utilisateur laquelle écraser : il ira les corriger dans le détail.
   */
  saisirRealise(chantierId: string, employeeId: string, date: string, hours: string | number) {
    const tenantId = this.context.requireTenantId();
    if (!ISO_DATE.test(date)) throw new BadRequestException('Date attendue au format AAAA-MM-JJ.');
    const h = new Decimal(hours ?? 0);
    if (h.isNegative()) throw new BadRequestException('Les heures ne peuvent pas être négatives.');

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const fiche = await this.assertSalarie(em, employeeId);
      const existantes: Array<{ id: string; imputed_at: string | null }> = await em.query(
        `SELECT id, imputed_at FROM timesheet
          WHERE chantier_id = $1 AND employee_id = $2 AND work_date = $3`,
        [chantierId, employeeId, date],
      );
      if (existantes.some((l) => l.imputed_at)) {
        throw new ConflictException(
          'Ce jour est arrêté : ses heures alimentent déjà le résultat du chantier.',
        );
      }
      if (existantes.length > 1) {
        throw new ConflictException(
          'Plusieurs saisies existent ce jour-là (heures ventilées sur plusieurs ouvrages). '
          + 'Corrigez-les depuis la liste détaillée des pointages.',
        );
      }

      if (h.isZero()) {
        if (existantes.length === 1) {
          await em.query(`DELETE FROM timesheet WHERE id = $1`, [existantes[0].id]);
        }
        return { employeeId, date, hours: '0' };
      }

      const cout = h.times(fiche.hourly_cost).toDecimalPlaces(2);
      const libelle = [fiche.first_name, fiche.last_name].filter(Boolean).join(' ');
      if (existantes.length === 1) {
        const rows = returningRows<{ hours: string }>(
          await em.query(
            `UPDATE timesheet SET hours = $2, cost = $3, updated_at = now()
              WHERE id = $1 RETURNING hours::text AS hours`,
            [existantes[0].id, h.toString(), cout.toString()],
          ),
        );
        return { employeeId, date, hours: rows[0].hours };
      }
      await em.query(
        `INSERT INTO timesheet
           (tenant_id, chantier_id, employee_id, employee_label, work_date, hours, hourly_cost,
            cost, code_analytique_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          tenantId, chantierId, employeeId, libelle, date, h.toString(),
          String(fiche.hourly_cost), cout.toString(), fiche.code_analytique_id ?? null,
        ],
      );
      return { employeeId, date, hours: h.toString() };
    });
  }

  private async assertSalarie(
    em: { query: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>> },
    employeeId: string,
  ) {
    const fiche = (
      await em.query(
        `SELECT first_name, last_name, hourly_cost, code_analytique_id FROM employee
          WHERE id = $1 AND deleted_at IS NULL`,
        [employeeId],
      )
    )[0] as {
      first_name: string | null; last_name: string; hourly_cost: string;
      code_analytique_id: string | null;
    } | undefined;
    if (!fiche) throw new NotFoundException('Salarié introuvable');
    return fiche;
  }
}

/** Jours d'une période, bornes comprises. */
function joursEntre(debut: string, fin: string): string[] {
  const jours: string[] = [];
  const d = new Date(`${debut}T00:00:00Z`);
  const f = new Date(`${fin}T00:00:00Z`);
  for (let c = d; c <= f; c.setUTCDate(c.getUTCDate() + 1)) {
    jours.push(c.toISOString().slice(0, 10));
  }
  return jours;
}

/** Lundi à vendredi. */
function estOuvre(jour: string): boolean {
  const j = new Date(`${jour}T00:00:00Z`).getUTCDay();
  return j >= 1 && j <= 5;
}

function bornes(debut: string, fin: string): { debut: string; fin: string } {
  if (!ISO_DATE.test(debut ?? '') || !ISO_DATE.test(fin ?? '')) {
    throw new BadRequestException('Période attendue au format AAAA-MM-JJ.');
  }
  if (debut > fin) throw new BadRequestException('La date de début doit précéder la date de fin.');
  // Une période trop large produirait une grille illisible et une requête lourde.
  if (joursEntre(debut, fin).length > 62) {
    throw new BadRequestException('Période trop longue : deux mois au maximum.');
  }
  return { debut, fin };
}
