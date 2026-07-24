import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { FinancialConfigService, FormulaSetInput } from './financial-config.service';
import { AdvancementInput, AdvancementService } from './advancement.service';
import { AnalyticalResultsService } from './analytical-results.service';
import { FinancialForecastService } from './financial-forecast.service';
import { PortfolioService } from './portfolio.service';
import { MonthlyService } from './monthly.service';
import { PilotageService } from './pilotage.service';

@Controller()
export class FinancialController {
  constructor(
    private readonly config: FinancialConfigService,
    private readonly advancement: AdvancementService,
    private readonly analyticalResults: AnalyticalResultsService,
    private readonly forecast: FinancialForecastService,
    private readonly portfolio: PortfolioService,
    private readonly monthly: MonthlyService,
    private readonly pilotage: PilotageService,
  ) {}

  /** Courbes de pilotage : budget / budget avancé / réalisé+engagé, mois par mois (§5.8). */
  @Get('chantiers/:chantierId/pilotage')
  @RequiresCapability('financial.dashboard')
  @RequiresPermission('financial.read')
  getPilotage(@Param('chantierId') chantierId: string) {
    return this.pilotage.getSeries(chantierId);
  }

  /** Gestion mensuelle : flux engagé / réalisé par nature, en 3 colonnes M / M-1 / CUMUL (§5.8). */
  @Get('chantiers/:chantierId/monthly')
  @RequiresCapability('financial.dashboard')
  @RequiresPermission('financial.read')
  getMonthly(@Param('chantierId') chantierId: string, @Query('month') month: string) {
    return this.monthly.getMonthly(chantierId, month);
  }

  /** Mois clôturés du chantier. */
  @Get('chantiers/:chantierId/closures')
  @RequiresCapability('financial.dashboard')
  @RequiresPermission('financial.read')
  getClosures(@Param('chantierId') chantierId: string) {
    return this.monthly.listClosures(chantierId);
  }

  /** Clôture un mois : fige l'instantané mensuel (cumuls + flux du mois). */
  @Post('chantiers/:chantierId/monthly/:month/close')
  @RequiresCapability('financial.forecast')
  @RequiresPermission('financial.write')
  closeMonth(@Param('chantierId') chantierId: string, @Param('month') month: string) {
    return this.monthly.closeMonth(chantierId, month);
  }

  /** Vue Direction : portefeuille de tous les chantiers, chantiers à risque en tête (§5.8). */
  @Get('financial/portfolio')
  @RequiresCapability('financial.portfolio')
  @RequiresPermission('financial.read')
  getPortfolio() {
    return this.portfolio.getPortfolio();
  }

  @Get('chantiers/:chantierId/analytical-results')
  @RequiresCapability('financial.dashboard')
  @RequiresPermission('financial.read')
  getAnalyticalResults(@Param('chantierId') chantierId: string) {
    return this.analyticalResults.chantierAnalyticalResults(chantierId);
  }

  @Get('chantiers/:chantierId/forecast')
  @RequiresCapability('financial.forecast')
  @RequiresPermission('financial.read')
  getForecast(@Param('chantierId') chantierId: string) {
    return this.forecast.chantierForecast(chantierId);
  }

  @Get('financial/formula-set')
  @RequiresCapability('financial.forecast')
  @RequiresPermission('financial.read')
  getFormulaSet() {
    return this.config.getActiveFormulaSet();
  }

  @Put('financial/formula-set')
  @RequiresCapability('financial.forecast')
  @RequiresPermission('financial.write')
  updateFormulaSet(@Body() body: FormulaSetInput) {
    if (body?.eacMethod && !['m1', 'm2'].includes(body.eacMethod)) {
      throw new BadRequestException('eacMethod must be m1 or m2');
    }
    return this.config.updateFormulaSet(body ?? {});
  }

  @Post('chantiers/:chantierId/advancement')
  @RequiresCapability('financial.forecast')
  @RequiresPermission('financial.write')
  recordAdvancement(@Param('chantierId') chantierId: string, @Body() body: AdvancementInput) {
    if (body?.pct == null) {
      throw new BadRequestException('pct is required');
    }
    return this.advancement.record(chantierId, body);
  }

  @Get('chantiers/:chantierId/advancement')
  @RequiresCapability('financial.forecast')
  @RequiresPermission('financial.read')
  getAdvancement(@Param('chantierId') chantierId: string) {
    return this.advancement.current(chantierId);
  }

  /* ─── Avancement ouvrage par ouvrage (cahier §5.8) ─── */

  @Get('chantiers/:chantierId/line-advancement')
  @RequiresCapability('financial.forecast')
  @RequiresPermission('financial.read')
  getLineAdvancement(@Param('chantierId') chantierId: string) {
    return this.advancement.currentLines(chantierId);
  }

  @Post('chantiers/:chantierId/line-advancement')
  @RequiresCapability('financial.forecast')
  @RequiresPermission('financial.write')
  recordLineAdvancement(
    @Param('chantierId') chantierId: string,
    @Body() body: { executionLineId?: string; pct?: string | number },
  ) {
    if (!body?.executionLineId || body?.pct == null) {
      throw new BadRequestException('executionLineId and pct are required');
    }
    return this.advancement.recordLine(chantierId, body.executionLineId, body.pct);
  }

  /** Applique un avancement en masse : global (tout le chantier), par marché ou par sous-arbre. */
  @Post('chantiers/:chantierId/line-advancement/apply')
  @RequiresCapability('financial.forecast')
  @RequiresPermission('financial.write')
  applyLineAdvancement(
    @Param('chantierId') chantierId: string,
    @Body() body: { pct?: string | number; parentLineId?: string | null; marcheId?: string | null },
  ) {
    if (body?.pct == null) {
      throw new BadRequestException('pct is required');
    }
    return this.advancement.applyToLines(chantierId, {
      pct: body.pct, parentLineId: body.parentLineId ?? null, marcheId: body.marcheId ?? null,
    });
  }

  /** Reprend l'avancement des situations comme proposition (modifiable ensuite). */
  @Post('chantiers/:chantierId/line-advancement/from-situations')
  @RequiresCapability('financial.forecast')
  @RequiresPermission('financial.write')
  applyFromSituations(@Param('chantierId') chantierId: string) {
    return this.advancement.applyFromSituations(chantierId);
  }
}
