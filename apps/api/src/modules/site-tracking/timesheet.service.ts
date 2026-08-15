import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { returningRows } from '../../core/database/returning.util';

export interface TimesheetInput {
  executionLineId?: string | null;
  /** Salarié du fichier : son nom et son coût horaire sont repris de la fiche. */
  employeeId?: string | null;
  /** Nom saisi à la main — accepté quand aucune fiche n'existe encore (intérim de passage). */
  employee?: string;
  /** Créneau facultatif « HH:MM ». Fourni, il rend le chevauchement détectable à l'heure près. */
  startTime?: string | null;
  endTime?: string | null;
  date: string;
  hours: string | number;
  hourlyCost: string | number;
  /** Imputation analytique optionnelle au code analytique du plan partagé (MO réalisée, §5.8). */
  codeAnalytiqueId?: string | null;
}

@Injectable()
export class TimesheetService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  create(chantierId: string, input: TimesheetInput) {
    const tenantId = this.context.requireTenantId();
    const creneau = normaliserCreneau(input.startTime, input.endTime);
    // Un créneau saisi vaut mieux qu'un nombre d'heures retapé : on en déduit la durée.
    const hours = creneau && (input.hours === undefined || input.hours === null)
      ? dureeDuCreneau(creneau)
      : new Decimal(input.hours ?? 0);
    if (hours.isNegative()) {
      throw new BadRequestException('hours must be >= 0');
    }

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const chantier = await em.query(`SELECT id FROM chantier WHERE id = $1`, [chantierId]);
      if (chantier.length === 0) {
        throw new NotFoundException(`Unknown chantier "${chantierId}"`);
      }
      if (input.executionLineId) {
        const line = await em.query(
          `SELECT id FROM execution_line WHERE id = $1 AND chantier_id = $2`,
          [input.executionLineId, chantierId],
        );
        if (line.length === 0) {
          throw new BadRequestException('execution line does not belong to this chantier');
        }
      }
      if (input.codeAnalytiqueId) {
        const code = await em.query(`SELECT id FROM analytical_code WHERE id = $1`, [input.codeAnalytiqueId]);
        if (code.length === 0) {
          throw new NotFoundException(`Unknown code analytique "${input.codeAnalytiqueId}"`);
        }
      }

      // Salarié du fichier : son nom et son coût horaire viennent de la fiche, pour qu'une heure
      // pointée coûte le même prix partout. Le coût reste forçable ligne à ligne (heure de nuit,
      // intérim facturé autrement) — sinon on empêcherait de saisir la réalité.
      // Poste analytique : celui de la ligne s'il est donné, sinon celui de la fiche salarié.
      // Sans ce report, les heures tombaient hors analytique et les résultats par code étaient faux.
      let codeAnalytiqueId = input.codeAnalytiqueId ?? null;
      let libelle = (input.employee ?? '').trim();
      let coutHoraire = input.hourlyCost === undefined || input.hourlyCost === null
        ? null
        : new Decimal(input.hourlyCost);
      if (input.employeeId) {
        const fiche = (
          await em.query(
            `SELECT first_name, last_name, hourly_cost, code_analytique_id FROM employee
              WHERE id = $1 AND deleted_at IS NULL`,
            [input.employeeId],
          )
        )[0];
        if (!fiche) throw new NotFoundException('Salarié introuvable');
        libelle = [fiche.first_name, fiche.last_name].filter(Boolean).join(' ');
        if (coutHoraire === null) coutHoraire = new Decimal(fiche.hourly_cost);
        if (!codeAnalytiqueId) codeAnalytiqueId = fiche.code_analytique_id ?? null;
      }
      if (!libelle) {
        throw new BadRequestException('Choisissez un salarié, ou saisissez un nom.');
      }
      const hourlyCost = coutHoraire ?? new Decimal(0);
      if (hourlyCost.isNegative()) {
        throw new BadRequestException('hourlyCost must be >= 0');
      }
      const cost = hours.times(hourlyCost).toDecimalPlaces(2);

      return (
        await em.query(
          `INSERT INTO timesheet
             (tenant_id, chantier_id, execution_line_id, employee_id, employee_label, work_date,
              hours, hourly_cost, cost, code_analytique_id, start_time, end_time)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            tenantId,
            chantierId,
            input.executionLineId ?? null,
            input.employeeId ?? null,
            libelle,
            input.date,
            hours.toString(),
            hourlyCost.toString(),
            cost.toString(),
            codeAnalytiqueId,
            creneau?.debut ?? null,
            creneau?.fin ?? null,
          ],
        )
      )[0];
    });
  }

  list(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT * FROM timesheet WHERE chantier_id = $1 ORDER BY work_date ASC, created_at ASC`,
        [chantierId],
      ),
    );
  }

  /** Total valued labour cost (réalisé MO) for a chantier, with per-line breakdown. */
  summary(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const total = (
        await em.query(
          `SELECT COALESCE(SUM(cost), 0)::numeric(16,2) AS total,
                  COALESCE(SUM(hours), 0)::numeric(12,2) AS hours
             FROM timesheet WHERE chantier_id = $1`,
          [chantierId],
        )
      )[0];
      const byLine = await em.query(
        `SELECT execution_line_id,
                COALESCE(SUM(cost), 0)::numeric(16,2) AS cost,
                COALESCE(SUM(hours), 0)::numeric(12,2) AS hours
           FROM timesheet WHERE chantier_id = $1
          GROUP BY execution_line_id`,
        [chantierId],
      );
      return { totalCost: total.total, totalHours: total.hours, byLine };
    });
  }
  /**
   * Corrige un pointage NON IMPUTÉ.
   *
   * Sans cette correction, une faute de frappe restait dans le réalisé à vie : on ne pouvait que
   * saisir, jamais rectifier. Le refus après imputation est délibéré — voir `assertModifiable`.
   */
  update(timesheetId: string, input: Partial<TimesheetInput>) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const t = await this.assertModifiable(em, timesheetId);

      const hours = input.hours === undefined ? new Decimal(String(t.hours)) : new Decimal(input.hours);
      if (hours.isNegative()) throw new BadRequestException('hours must be >= 0');

      let libelle = t.employee_label as string;
      let employeeId = (t.employee_id as string | null) ?? null;
      let hourlyCost =
        input.hourlyCost === undefined
          ? new Decimal(String(t.hourly_cost))
          : new Decimal(input.hourlyCost);

      if (input.employeeId !== undefined) {
        employeeId = input.employeeId;
        if (employeeId) {
          const fiche = (
            await em.query(
              `SELECT first_name, last_name, hourly_cost FROM employee
                WHERE id = $1 AND deleted_at IS NULL`,
              [employeeId],
            )
          )[0];
          if (!fiche) throw new NotFoundException('Salarié introuvable');
          libelle = [fiche.first_name, fiche.last_name].filter(Boolean).join(' ');
          if (input.hourlyCost === undefined) hourlyCost = new Decimal(fiche.hourly_cost);
        }
      }
      if (input.employee !== undefined && !employeeId) {
        libelle = (input.employee ?? '').trim();
      }
      if (!libelle) throw new BadRequestException('Choisissez un salarié, ou saisissez un nom.');
      if (hourlyCost.isNegative()) throw new BadRequestException('hourlyCost must be >= 0');

      if (input.executionLineId !== undefined && input.executionLineId) {
        const line = await em.query(
          `SELECT id FROM execution_line WHERE id = $1 AND chantier_id = $2`,
          [input.executionLineId, t.chantier_id],
        );
        if (line.length === 0) {
          throw new BadRequestException('execution line does not belong to this chantier');
        }
      }

      const cost = hours.times(hourlyCost).toDecimalPlaces(2);
      return returningRows<Record<string, unknown>>(
        await em.query(
          `UPDATE timesheet
              SET employee_id = $2, employee_label = $3, work_date = $4, hours = $5,
                  hourly_cost = $6, cost = $7,
                  execution_line_id = COALESCE($8, execution_line_id),
                  updated_at = now()
            WHERE id = $1
            RETURNING *`,
          [
            timesheetId,
            employeeId,
            libelle,
            input.date ?? String(t.work_date),
            hours.toString(),
            hourlyCost.toString(),
            cost.toString(),
            input.executionLineId ?? null,
          ],
        ),
      )[0];
    });
  }

  /** Supprime un pointage NON IMPUTÉ (saisie du mauvais chantier, doublon…). */
  remove(timesheetId: string): Promise<{ deleted: true }> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertModifiable(em, timesheetId);
      await em.query(`DELETE FROM timesheet WHERE id = $1`, [timesheetId]);
      return { deleted: true as const };
    });
  }

  /**
   * Arrête les heures d'un mois : elles deviennent non modifiables.
   *
   * C'est l'équivalent du « traitement » d'Onaya. On le fait par mois entier plutôt que ligne à
   * ligne : un résultat de chantier se lit par période, et arrêter la moitié d'un mois donnerait
   * un chiffre qu'on ne saurait pas interpréter.
   */
  imputer(chantierId: string, mois: string): Promise<{ imputes: number; mois: string }> {
    const tenantId = this.context.requireTenantId();
    const { debut, fin } = bornesDuMois(mois);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = returningRows<{ id: string }>(
        await em.query(
        `UPDATE timesheet SET imputed_at = now(), updated_at = now()
          WHERE chantier_id = $1 AND imputed_at IS NULL
            AND work_date >= $2 AND work_date <= $3
          RETURNING id`,
        [chantierId, debut, fin],
        ),
      );
      return { imputes: rows.length, mois };
    });
  }

  /**
   * Contrôle du pointage d'un mois : la grille salarié × jour, et ce qui cloche.
   *
   * Le conducteur doit pouvoir relire un mois AVANT de l'arrêter. On signale ce qui trahit
   * habituellement une erreur de saisie : une journée anormalement longue, deux lignes pour le
   * même salarié le même jour, une heure sans coût (elle ne pèserait rien dans le réalisé), ou un
   * nom libre — signe qu'une fiche salarié manque.
   */
  controle(chantierId: string, mois: string) {
    const tenantId = this.context.requireTenantId();
    const { debut, fin } = bornesDuMois(mois);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const lignes: Array<{
        id: string; employee_id: string | null; employee_label: string; work_date: string;
        hours: string; hourly_cost: string; cost: string; imputed_at: string | null;
      }> = await em.query(
        `SELECT id, employee_id, employee_label, work_date::text AS work_date,
                hours, hourly_cost, cost, imputed_at
           FROM timesheet
          WHERE chantier_id = $1 AND work_date >= $2 AND work_date <= $3
          ORDER BY employee_label, work_date`,
        [chantierId, debut, fin],
      );

      const parSalarie = new Map<string, {
        employeeId: string | null; label: string;
        jours: Record<string, string>; heures: Decimal; cout: Decimal; anomalies: string[];
      }>();

      for (const l of lignes) {
        const cle = l.employee_id ?? `libre:${l.employee_label}`;
        const entree = parSalarie.get(cle) ?? {
          employeeId: l.employee_id,
          label: l.employee_label,
          jours: {} as Record<string, string>,
          heures: new Decimal(0),
          cout: new Decimal(0),
          anomalies: [] as string[],
        };
        // Deux lignes le même jour : souvent une double saisie, parfois deux ouvrages — on le dit
        // sans l'interdire, c'est au conducteur de trancher.
        if (entree.jours[l.work_date] !== undefined) {
          entree.anomalies.push(`Plusieurs saisies le ${l.work_date}`);
        }
        const jour = new Decimal(entree.jours[l.work_date] ?? 0).plus(l.hours);
        entree.jours[l.work_date] = jour.toString();
        entree.heures = entree.heures.plus(l.hours);
        entree.cout = entree.cout.plus(l.cost);
        if (jour.greaterThan(12)) {
          entree.anomalies.push(`${jour.toString()} h le ${l.work_date} — journée anormalement longue`);
        }
        if (new Decimal(l.hourly_cost).isZero() && !new Decimal(l.hours).isZero()) {
          entree.anomalies.push(`Coût horaire à 0 le ${l.work_date} — ces heures ne pèsent rien`);
        }
        if (!l.employee_id) {
          entree.anomalies.push('Nom saisi à la main — créez la fiche salarié pour fiabiliser le suivi');
        }
        parSalarie.set(cle, entree);
      }

      const salaries = [...parSalarie.values()].map((e) => ({
        employeeId: e.employeeId,
        label: e.label,
        jours: e.jours,
        heures: e.heures.toFixed(2),
        cout: e.cout.toFixed(2),
        // Un même motif peut revenir plusieurs fois : on ne le répète pas.
        anomalies: [...new Set(e.anomalies)],
      }));

      const totalHeures = salaries.reduce((s, e) => s.plus(e.heures), new Decimal(0));
      const totalCout = salaries.reduce((s, e) => s.plus(e.cout), new Decimal(0));
      const impute = lignes.length > 0 && lignes.every((l) => l.imputed_at !== null);

      return {
        mois,
        debut,
        fin,
        salaries,
        totalHeures: totalHeures.toFixed(2),
        totalCout: totalCout.toFixed(2),
        lignes: lignes.length,
        impute,
        anomalies: salaries.reduce((n, e) => n + e.anomalies.length, 0),
      };
    });
  }

  /** Un pointage imputé est figé : le laisser bouger ferait mentir un résultat déjà publié. */
  private async assertModifiable(
    em: { query: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>> },
    timesheetId: string,
  ) {
    // `work_date` en TEXTE : le pilote renvoie sinon un objet Date, qu'on ne peut pas réécrire
    // tel quel dans une colonne `date`.
    const t = (
      await em.query(
        `SELECT *, work_date::text AS work_date FROM timesheet WHERE id = $1`,
        [timesheetId],
      )
    )[0];
    if (!t) throw new NotFoundException('Pointage introuvable');
    if (t.imputed_at) {
      throw new ConflictException(
        'Ce pointage est imputé : ses heures alimentent déjà le résultat du chantier. '
        + 'Saisissez une ligne de correction plutôt que de modifier celle-ci.',
      );
    }
    return t;
  }
}

/** Bornes d'un mois « AAAA-MM ». Rejette tout autre format plutôt que de deviner. */
function bornesDuMois(mois: string): { debut: string; fin: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mois ?? '')) {
    throw new BadRequestException('Mois attendu au format AAAA-MM (ex. 2026-03).');
  }
  const [a, m] = mois.split('-').map(Number);
  const dernier = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { debut: `${mois}-01`, fin: `${mois}-${String(dernier).padStart(2, '0')}` };
}

const HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Valide un créneau « HH:MM ». Les deux bornes vont ensemble, ou aucune. */
export function normaliserCreneau(
  debut: string | null | undefined,
  fin: string | null | undefined,
): { debut: string; fin: string } | null {
  const d = (debut ?? '').trim();
  const f = (fin ?? '').trim();
  if (!d && !f) return null;
  if (!d || !f) {
    throw new BadRequestException('Un créneau demande une heure de début ET une heure de fin.');
  }
  if (!HEURE.test(d) || !HEURE.test(f)) {
    throw new BadRequestException('Heures attendues au format HH:MM.');
  }
  if (f <= d) {
    throw new BadRequestException('L’heure de fin doit suivre l’heure de début.');
  }
  return { debut: d, fin: f };
}

/** Durée d'un créneau, en heures décimales (08:00–12:30 → 4,5). */
export function dureeDuCreneau(creneau: { debut: string; fin: string }): Decimal {
  const minutes = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  return new Decimal(minutes(creneau.fin) - minutes(creneau.debut)).dividedBy(60).toDecimalPlaces(2);
}
