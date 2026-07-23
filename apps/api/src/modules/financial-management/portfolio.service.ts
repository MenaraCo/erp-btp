import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { FinancialForecastService } from './financial-forecast.service';

export interface PortfolioRow {
  chantierId: string;
  code: string;
  name: string | null;
  avancement: string;
  vente: string;
  budget: string;
  engage: string;
  realise: string;
  eac: string | null;
  margePrevisionnelle: string | null;
  margePrevisionnellePct: string | null;
  ecartAuStade: string;
  alerts: string[];
  /** Score de risque : plus il est haut, plus le chantier est à surveiller (tri décroissant). */
  riskScore: number;
}

export interface PortfolioTotals {
  vente: string;
  budget: string;
  engage: string;
  realise: string;
  eac: string;
  margePrevisionnelle: string;
  margePrevisionnellePct: string | null;
  chantiers: number;
  aRisque: number;
}

/**
 * Vue Direction (cahier des charges §5.8) : le portefeuille de chantiers avec, pour chacun, les
 * indicateurs prévisionnels déjà produits par le moteur `control-management`, plus un **classement
 * automatique des chantiers à risque**. Aucun calcul ici — on agrège en temps réel les sorties du
 * moteur (les formules restent versionnées et centralisées).
 */
@Injectable()
export class PortfolioService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly forecast: FinancialForecastService,
  ) {}

  async getPortfolio(): Promise<{ rows: PortfolioRow[]; totals: PortfolioTotals }> {
    const tenantId = this.context.requireTenantId();
    const chantiers: Array<{ id: string; code: string; name: string | null }> =
      await runInTenant(this.dataSource, tenantId, (em) =>
        em.query(
          `SELECT id, code, name FROM chantier WHERE deleted_at IS NULL ORDER BY created_at DESC`,
        ),
      );

    const rows: PortfolioRow[] = [];
    for (const c of chantiers) {
      const f = await this.forecast.chantierForecast(c.id);
      const ind = f.indicators;
      rows.push({
        chantierId: c.id,
        code: c.code,
        name: c.name,
        avancement: String(f.avancement),
        vente: String(f.inputs.vente),
        budget: String(f.inputs.budget),
        engage: String(f.inputs.engage),
        realise: String(f.inputs.realise),
        eac: ind.eac,
        margePrevisionnelle: ind.margePrevisionnelle,
        margePrevisionnellePct: ind.margePrevisionnellePct,
        ecartAuStade: ind.ecartAuStade,
        alerts: ind.alerts,
        riskScore: this.riskScore(ind),
      });
    }

    // Classement : chantiers à risque en tête, puis marge prévisionnelle la plus faible.
    rows.sort((a, b) => {
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      const ma = a.margePrevisionnellePct == null ? Infinity : Number(a.margePrevisionnellePct);
      const mb = b.margePrevisionnellePct == null ? Infinity : Number(b.margePrevisionnellePct);
      return ma - mb;
    });

    return { rows, totals: this.aggregate(rows) };
  }

  /** Score simple : chaque alerte pèse 2 ; une marge prévisionnelle négative ajoute 3. */
  private riskScore(ind: {
    alerts: string[];
    margePrevisionnelle: string | null;
  }): number {
    let score = ind.alerts.length * 2;
    if (ind.margePrevisionnelle != null && new Decimal(ind.margePrevisionnelle).isNegative()) {
      score += 3;
    }
    return score;
  }

  private aggregate(rows: PortfolioRow[]): PortfolioTotals {
    const sum = (pick: (r: PortfolioRow) => string | null) =>
      rows.reduce((acc, r) => acc.plus(new Decimal(pick(r) ?? 0)), new Decimal(0));

    const vente = sum((r) => r.vente);
    const eac = sum((r) => r.eac);
    const margePrevisionnelle = vente.minus(eac);
    const margePct = vente.isZero() ? null : margePrevisionnelle.dividedBy(vente);

    return {
      vente: vente.toFixed(2),
      budget: sum((r) => r.budget).toFixed(2),
      engage: sum((r) => r.engage).toFixed(2),
      realise: sum((r) => r.realise).toFixed(2),
      eac: eac.toFixed(2),
      margePrevisionnelle: margePrevisionnelle.toFixed(2),
      margePrevisionnellePct: margePct ? margePct.toFixed(4) : null,
      chantiers: rows.length,
      aRisque: rows.filter((r) => r.riskScore > 0).length,
    };
  }
}
