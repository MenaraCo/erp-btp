import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';

export interface TimesheetInput {
  executionLineId?: string | null;
  /** Salarié du fichier : son nom et son coût horaire sont repris de la fiche. */
  employeeId?: string | null;
  /** Nom saisi à la main — accepté quand aucune fiche n'existe encore (intérim de passage). */
  employee?: string;
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
    const hours = new Decimal(input.hours ?? 0);
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
      let libelle = (input.employee ?? '').trim();
      let coutHoraire = input.hourlyCost === undefined || input.hourlyCost === null
        ? null
        : new Decimal(input.hourlyCost);
      if (input.employeeId) {
        const fiche = (
          await em.query(
            `SELECT first_name, last_name, hourly_cost FROM employee
              WHERE id = $1 AND deleted_at IS NULL`,
            [input.employeeId],
          )
        )[0];
        if (!fiche) throw new NotFoundException('Salarié introuvable');
        libelle = [fiche.first_name, fiche.last_name].filter(Boolean).join(' ');
        if (coutHoraire === null) coutHoraire = new Decimal(fiche.hourly_cost);
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
              hours, hourly_cost, cost, code_analytique_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
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
            input.codeAnalytiqueId ?? null,
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
}
