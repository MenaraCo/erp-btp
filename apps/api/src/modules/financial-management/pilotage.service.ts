import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { FinancialForecastService } from './financial-forecast.service';

export interface PilotagePoint {
  month: string;
  /** Cumuls au stade (fin de mois). */
  engage: string;
  realise: string;
  engageRealise: string;
  /** Budget avancé au mois (issu de la clôture, ou point courant en direct) ; null sinon. */
  budgetAvance: string | null;
  /** Prévision à terminaison (EAC) au mois ; null si non figé et pas le mois courant. */
  eac: string | null;
  /** Vrai si le mois est clôturé (point historique figé). */
  closed: boolean;
}

export interface PilotageSeries {
  chantierId: string;
  /** Budget objectif — ligne de référence horizontale. */
  budget: string;
  points: PilotagePoint[];
}

/**
 * Courbes de pilotage (cahier §5.8) : trace simultanément budget / budget avancé / réalisé+engagé
 * pour visualiser immédiatement les dérives. Les cumuls réalisé et engagé sont recalculés en temps
 * réel par mois (dates des mouvements) ; le budget avancé et l'EAC — qui dépendent de l'avancement,
 * non historisé — proviennent des **clôtures mensuelles** figées, complétés par le point courant en
 * direct.
 */
@Injectable()
export class PilotageService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly forecast: FinancialForecastService,
  ) {}

  async getSeries(chantierId: string): Promise<PilotageSeries> {
    const tenantId = this.context.requireTenantId();
    const live = await this.forecast.chantierForecast(chantierId); // 404 si chantier inconnu
    const budget = String(live.inputs.budget);

    return runInTenant(this.dataSource, tenantId, async (em) => {
      // Flux mensuels d'engagé (commandes validées, datées par la validation).
      const engageByMonth: Array<{ m: string; v: string }> = await em.query(
        `SELECT to_char(date_trunc('month', o.validated_at), 'YYYY-MM') AS m,
                SUM(l.amount_ht)::numeric(16,2) AS v
           FROM purchase_order_line l
           JOIN purchase_order o ON o.id = l.order_id
          WHERE o.chantier_id = $1 AND o.status = 'validated' AND o.validated_at IS NOT NULL
          GROUP BY 1`,
        [chantierId],
      );
      // Flux mensuels de réalisé (factures fournisseur + pointages).
      const realiseByMonth: Array<{ m: string; v: string }> = await em.query(
        `SELECT m, SUM(v)::numeric(16,2) AS v FROM (
            SELECT to_char(date_trunc('month', COALESCE(invoice_date, created_at::date)), 'YYYY-MM') AS m,
                   amount_ht AS v
              FROM supplier_invoice WHERE chantier_id = $1
            UNION ALL
            SELECT to_char(date_trunc('month', work_date), 'YYYY-MM') AS m, cost AS v
              FROM timesheet WHERE chantier_id = $1
          ) t GROUP BY m`,
        [chantierId],
      );
      // Clôtures figées : budget avancé / EAC par mois.
      const closures: Array<{ m: string; snapshot: { indicators?: { budgetAvance?: string; eac?: string | null } } }> =
        await em.query(
          `SELECT to_char(month, 'YYYY-MM') AS m, snapshot FROM monthly_closure WHERE chantier_id = $1`,
          [chantierId],
        );

      const engMap = new Map(engageByMonth.map((r) => [r.m, r.v]));
      const realMap = new Map(realiseByMonth.map((r) => [r.m, r.v]));
      const closureMap = new Map(closures.map((r) => [r.m, r.snapshot?.indicators ?? {}]));

      // Plage de mois : du premier mouvement au mois courant.
      const months = [
        ...new Set([...engMap.keys(), ...realMap.keys(), ...closureMap.keys()]),
      ].sort();
      const currentMonth = new Date().toISOString().slice(0, 7);
      const rangeStart = months[0] ?? currentMonth;
      const monthList = this.monthRange(rangeStart, currentMonth);

      let engCum = new Decimal(0);
      let realCum = new Decimal(0);
      const points: PilotagePoint[] = monthList.map((m) => {
        engCum = engCum.plus(new Decimal(engMap.get(m) ?? 0));
        realCum = realCum.plus(new Decimal(realMap.get(m) ?? 0));
        const isCurrent = m === currentMonth;
        const closure = closureMap.get(m);
        const budgetAvance = closure?.budgetAvance ?? (isCurrent ? live.indicators.budgetAvance : null);
        const eac = closure?.eac ?? (isCurrent ? live.indicators.eac : null);
        return {
          month: m,
          engage: engCum.toFixed(2),
          realise: realCum.toFixed(2),
          engageRealise: engCum.plus(realCum).toFixed(2),
          budgetAvance: budgetAvance ?? null,
          eac: eac ?? null,
          closed: closureMap.has(m),
        };
      });

      return { chantierId, budget, points };
    });
  }

  /** Liste des mois « YYYY-MM » de start à end inclus. */
  private monthRange(start: string, end: string): string[] {
    if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) {
      throw new BadRequestException('Mois invalide');
    }
    const [ys, ms] = start.split('-').map(Number);
    const [ye, me] = end.split('-').map(Number);
    const out: string[] = [];
    let y = ys;
    let mo = ms;
    // Garde-fou : 240 mois max (20 ans).
    for (let i = 0; i < 240; i++) {
      out.push(`${y}-${String(mo).padStart(2, '0')}`);
      if (y === ye && mo === me) break;
      if (y > ye || (y === ye && mo > me)) break;
      mo += 1;
      if (mo > 12) { mo = 1; y += 1; }
    }
    return out;
  }
}
