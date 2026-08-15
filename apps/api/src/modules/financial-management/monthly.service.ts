import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { engageMainOeuvreFlux } from '../site-tracking/labor-commitment';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { returningRows } from '../../core/database/returning.util';
import { FinancialForecastService } from './financial-forecast.service';

const NATURES = ['labor', 'material', 'equipment', 'subcontract', 'site_overhead'] as const;
const NATURE_LABELS: Record<string, string> = {
  labor: 'Main d’œuvre',
  material: 'Matériaux',
  equipment: 'Matériel',
  subcontract: 'Sous-traitance',
  site_overhead: 'Frais de chantier',
};

/** Une cellule à trois temps : mois en cours, mois précédent, cumul depuis le début. */
interface Triple {
  m: string;
  m1: string;
  cumul: string;
}
interface NatureFlows {
  nature: string;
  label: string;
  engage: Triple;
  realise: Triple;
}
export interface MonthlyResult {
  chantierId: string;
  /** Mois de référence (M), au format YYYY-MM. */
  month: string;
  prevMonth: string;
  byNature: NatureFlows[];
  totals: { engage: Triple; realise: Triple };
  /** Vrai si le mois est clôturé (instantané figé). */
  closed: boolean;
}

/**
 * Gestion mensuelle du contrôle de gestion (cahier §5.8) : présentation généralisée à trois
 * colonnes **Mois M / Mois M-1 / CUMUL**. Les flux (engagé, réalisé) sont regroupés par mois sur la
 * date des mouvements — commande validée, facture fournisseur, pointage — donc calculés en temps
 * réel, jamais en batch. La clôture fige un instantané mensuel pour l'historique.
 */
@Injectable()
export class MonthlyService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly forecast: FinancialForecastService,
  ) {}

  /** Normalise « YYYY-MM » en 1er du mois, et calcule les bornes M-1 / M / M+1. */
  private bounds(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month ?? '')) {
      throw new BadRequestException('month doit être au format YYYY-MM');
    }
    const start = `${month}-01`;
    const d = new Date(`${start}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Mois invalide');
    const iso = (dt: Date) => dt.toISOString().slice(0, 10);
    const prevStart = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
    const nextStart = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
    const prevMonth = prevStart.slice(0, 7);
    return { start, prevStart, nextStart, prevMonth };
  }

  async getMonthly(chantierId: string, month: string): Promise<MonthlyResult> {
    const tenantId = this.context.requireTenantId();
    const { start, prevStart, nextStart, prevMonth } = this.bounds(month);

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const exists = await em.query(`SELECT 1 FROM chantier WHERE id = $1`, [chantierId]);
      if (exists.length === 0) throw new BadRequestException('Chantier introuvable');

      // Engagé = lignes de commandes VALIDÉES, datées par la validation de la commande (§5.8).
      const engage: Array<{ nature: string; m: string; m1: string; cumul: string }> =
        await em.query(
          `SELECT l.nature,
                  COALESCE(SUM(l.amount_ht) FILTER (WHERE o.validated_at >= $2 AND o.validated_at < $3), 0)::numeric(16,2) AS m,
                  COALESCE(SUM(l.amount_ht) FILTER (WHERE o.validated_at >= $4 AND o.validated_at < $2), 0)::numeric(16,2) AS m1,
                  COALESCE(SUM(l.amount_ht) FILTER (WHERE o.validated_at < $3), 0)::numeric(16,2) AS cumul
             FROM purchase_order_line l
             JOIN purchase_order o ON o.id = l.order_id
            WHERE o.chantier_id = $1 AND o.status = 'validated' AND o.validated_at IS NOT NULL
            GROUP BY l.nature`,
          [chantierId, start, nextStart, prevStart],
        );

      // Réalisé achats = factures fournisseur, datées par la date de facture.
      const realiseAchats: Array<{ nature: string; m: string; m1: string; cumul: string }> =
        await em.query(
          `SELECT nature,
                  COALESCE(SUM(amount_ht) FILTER (WHERE d >= $2 AND d < $3), 0)::numeric(16,2) AS m,
                  COALESCE(SUM(amount_ht) FILTER (WHERE d >= $4 AND d < $2), 0)::numeric(16,2) AS m1,
                  COALESCE(SUM(amount_ht) FILTER (WHERE d < $3), 0)::numeric(16,2) AS cumul
             FROM (SELECT nature, amount_ht, COALESCE(invoice_date, created_at::date) AS d
                     FROM supplier_invoice WHERE chantier_id = $1) s
            GROUP BY nature`,
          [chantierId, start, nextStart, prevStart],
        );

      // Réalisé main d'œuvre = pointages, datés par la date de travail, nature = labor.
      const realiseMo: Array<{ m: string; m1: string; cumul: string }> = await em.query(
        `SELECT COALESCE(SUM(cost) FILTER (WHERE work_date >= $2 AND work_date < $3), 0)::numeric(16,2) AS m,
                COALESCE(SUM(cost) FILTER (WHERE work_date >= $4 AND work_date < $2), 0)::numeric(16,2) AS m1,
                COALESCE(SUM(cost) FILTER (WHERE work_date < $3), 0)::numeric(16,2) AS cumul
           FROM timesheet WHERE chantier_id = $1`,
        [chantierId, start, nextStart, prevStart],
      );

      // Main d'œuvre engagée du mois : journées planifiées non pointées, datées par le jour prévu.
      const moEngage = await engageMainOeuvreFlux(em, chantierId, { start, nextStart, prevStart });
      const engMap = new Map(engage.map((r) => [r.nature, r]));
      const achMap = new Map(realiseAchats.map((r) => [r.nature, r]));
      const mo = realiseMo[0] ?? { m: '0', m1: '0', cumul: '0' };

      const add = (a: string, b: string) => (Number(a) + Number(b)).toFixed(2);
      const byNature: NatureFlows[] = NATURES.map((nature) => {
        const e = engMap.get(nature);
        const ach = achMap.get(nature);
        const realise: Triple =
          nature === 'labor'
            ? {
                m: add(ach?.m ?? '0', mo.m),
                m1: add(ach?.m1 ?? '0', mo.m1),
                cumul: add(ach?.cumul ?? '0', mo.cumul),
              }
            : { m: ach?.m ?? '0.00', m1: ach?.m1 ?? '0.00', cumul: ach?.cumul ?? '0.00' };
        const engage: Triple = nature === 'labor'
          ? {
              m: add(e?.m ?? '0', moEngage.m),
              m1: add(e?.m1 ?? '0', moEngage.m1),
              cumul: add(e?.cumul ?? '0', moEngage.cumul),
            }
          : { m: e?.m ?? '0.00', m1: e?.m1 ?? '0.00', cumul: e?.cumul ?? '0.00' };
        return {
          nature,
          label: NATURE_LABELS[nature],
          engage,
          realise,
        };
      });

      const totalTriple = (pick: (n: NatureFlows) => Triple): Triple => ({
        m: byNature.reduce((s, n) => s + Number(pick(n).m), 0).toFixed(2),
        m1: byNature.reduce((s, n) => s + Number(pick(n).m1), 0).toFixed(2),
        cumul: byNature.reduce((s, n) => s + Number(pick(n).cumul), 0).toFixed(2),
      });

      const closed = (
        await em.query(
          `SELECT 1 FROM monthly_closure WHERE chantier_id = $1 AND month = $2`,
          [chantierId, start],
        )
      ).length > 0;

      return {
        chantierId,
        month,
        prevMonth,
        byNature,
        totals: { engage: totalTriple((n) => n.engage), realise: totalTriple((n) => n.realise) },
        closed,
      };
    });
  }

  /**
   * Clôture un mois : fige un instantané (indicateurs prévisionnels courants + flux du mois) dans
   * `monthly_closure`. Ré-exécutable : réécrit l'instantané du même (chantier, mois).
   */
  async closeMonth(chantierId: string, month: string): Promise<{ month: string; closedAt: Date }> {
    const tenantId = this.context.requireTenantId();
    const { start } = this.bounds(month);
    const monthly = await this.getMonthly(chantierId, month);
    const forecast = await this.forecast.chantierForecast(chantierId);

    const snapshot = {
      flows: { totals: monthly.totals, byNature: monthly.byNature },
      indicators: forecast.indicators,
      avancement: forecast.avancement,
    };

    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = returningRows<{ closed_at: Date }>(
        await em.query(
          `INSERT INTO monthly_closure (tenant_id, chantier_id, month, snapshot)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (chantier_id, month)
           DO UPDATE SET snapshot = EXCLUDED.snapshot, closed_at = now()
           RETURNING closed_at`,
          [tenantId, chantierId, start, JSON.stringify(snapshot)],
        ),
      );
      return { month, closedAt: rows[0].closed_at };
    });
  }

  /** Mois clôturés d'un chantier (les plus récents d'abord). */
  listClosures(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(
        `SELECT to_char(month, 'YYYY-MM') AS month, closed_at
           FROM monthly_closure WHERE chantier_id = $1 ORDER BY month DESC`,
        [chantierId],
      ),
    );
  }
}
