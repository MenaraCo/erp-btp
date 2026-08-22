import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query,
} from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { FinancialConfigService, FormulaSetInput } from './financial-config.service';
import { AdvancementInput, AdvancementService } from './advancement.service';
import { AnalyticalResultsService } from './analytical-results.service';
import { FinancialForecastService } from './financial-forecast.service';
import { PortfolioService } from './portfolio.service';
import { MonthlyService } from './monthly.service';
import { PilotageService } from './pilotage.service';
import { BudgetService, NiveauBudget, RipageBudget, SaisieBudget } from './budget.service';

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
    private readonly budget: BudgetService,
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
    @Body() body: { executionLineId?: string; pct?: string | number; constatDate?: string | null },
  ) {
    if (!body?.executionLineId || body?.pct == null) {
      throw new BadRequestException('executionLineId and pct are required');
    }
    return this.advancement.recordLine(
      chantierId, body.executionLineId, body.pct, body.constatDate ?? null,
    );
  }

  /** Applique un avancement en masse : global (tout le chantier), par marché ou par sous-arbre. */
  @Post('chantiers/:chantierId/line-advancement/apply')
  @RequiresCapability('financial.forecast')
  @RequiresPermission('financial.write')
  applyLineAdvancement(
    @Param('chantierId') chantierId: string,
    @Body() body: {
      pct?: string | number;
      parentLineId?: string | null;
      marcheId?: string | null;
      constatDate?: string | null;
    },
  ) {
    if (body?.pct == null) {
      throw new BadRequestException('pct is required');
    }
    return this.advancement.applyToLines(chantierId, {
      pct: body.pct,
      parentLineId: body.parentLineId ?? null,
      marcheId: body.marcheId ?? null,
      constatDate: body.constatDate ?? null,
    });
  }

  /** Reprend l'avancement des situations comme proposition (modifiable ensuite). */
  @Post('chantiers/:chantierId/line-advancement/from-situations')
  @RequiresCapability('financial.forecast')
  @RequiresPermission('financial.write')
  applyFromSituations(@Param('chantierId') chantierId: string) {
    return this.advancement.applyFromSituations(chantierId);
  }

  /* ─── Budgets du chantier : étude / mouvements / global / initial (§17 à 20) ─── */

  @Get('chantiers/:chantierId/budgets')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  getBudgets(
    @Param('chantierId') chantierId: string,
    /** Photo de budget à mettre en regard ; par défaut la dernière figée. */
    @Query('reference') reference?: string,
  ) {
    return this.budget.tableau(chantierId, reference || null);
  }

  /** Avenants du chantier : ce qui peut légitimement agrandir l'enveloppe budgétaire. */
  @Get('chantiers/:chantierId/avenants')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  getAvenantsChantier(@Param('chantierId') chantierId: string) {
    return this.budget.avenants(chantierId);
  }

  /** Toutes les photos de budget du chantier : étude, contre-étude, exécution et leurs révisions. */
  @Get('chantiers/:chantierId/budgets/photos')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  getPhotosBudget(@Param('chantierId') chantierId: string) {
    return this.budget.baselines(chantierId);
  }

  /** Ressources du chantier avec leur budget : la liste où l'on choisit source et cible d'un ripage. */
  @Get('chantiers/:chantierId/budgets/ressources')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  getBudgetRessources(@Param('chantierId') chantierId: string) {
    return this.budget.ressources(chantierId);
  }

  @Get('chantiers/:chantierId/budgets/historique')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  getBudgetHistorique(@Param('chantierId') chantierId: string) {
    return this.budget.historique(chantierId);
  }

  @Post('chantiers/:chantierId/budgets/mouvements')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  saisirBudget(@Param('chantierId') chantierId: string, @Body() body: SaisieBudget) {
    if (!body?.codeAnalytiqueId && !body?.ressourceId) {
      throw new BadRequestException('Indiquez une ressource ou un code analytique.');
    }
    return this.budget.saisir(chantierId, body);
  }

  @Post('chantiers/:chantierId/budgets/ripages')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  riperBudget(@Param('chantierId') chantierId: string, @Body() body: RipageBudget) {
    if (body?.montant == null) throw new BadRequestException('Le montant à riper est obligatoire.');
    return this.budget.riper(chantierId, body);
  }

  /**
   * Fige une photo du budget global : étude, contre-étude ou exécution. Chaque appel crée une
   * VERSION — réviser ne remplace pas, il succède, et la référence précédente reste comparable.
   */
  @Post('chantiers/:chantierId/budgets/photos')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  figerBudget(
    @Param('chantierId') chantierId: string,
    @Body() body: { niveau?: NiveauBudget; commentaire?: string | null },
  ) {
    if (!body?.niveau) {
      throw new BadRequestException('Indiquez le niveau : étude, contre-étude ou exécution.');
    }
    return this.budget.figerBudget(chantierId, body.niveau, body.commentaire ?? null);
  }

  /* ─── Bons de budget : ce qui vient du devis attend d'être traité (guide §5.10) ─── */

  @Get('chantiers/:chantierId/budgets/bons')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.read')
  getBonsBudget(@Param('chantierId') chantierId: string) {
    return this.budget.bons(chantierId);
  }

  @Patch('chantiers/:chantierId/budgets/bons/lignes/:ligneId')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  majLigneBon(
    @Param('chantierId') chantierId: string,
    @Param('ligneId') ligneId: string,
    @Body() body: {
      codeAnalytiqueId?: string | null; libelle?: string;
      montant?: string | number; quantite?: string | number;
    },
  ) {
    return this.budget.majLigneBon(chantierId, ligneId, body ?? {});
  }

  @Post('chantiers/:chantierId/budgets/bons/lignes/:ligneId/acceptation')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  accepterLigneBon(
    @Param('chantierId') chantierId: string,
    @Param('ligneId') ligneId: string,
    @Body() body: { accepte?: boolean },
  ) {
    return this.budget.accepterLigneBon(chantierId, ligneId, body?.accepte !== false);
  }

  @Delete('chantiers/:chantierId/budgets/bons/lignes/:ligneId')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  supprimerLigneBon(
    @Param('chantierId') chantierId: string,
    @Param('ligneId') ligneId: string,
  ) {
    return this.budget.supprimerLigneBon(chantierId, ligneId);
  }

  @Post('chantiers/:chantierId/budgets/bons/:documentId/traiter')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  traiterBon(
    @Param('chantierId') chantierId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.budget.traiterBon(chantierId, documentId);
  }

  @Delete('chantiers/:chantierId/budgets/mouvements/:mouvementId')
  @RequiresCapability('site_tracking.budget')
  @RequiresPermission('site_tracking.write')
  supprimerMouvementBudget(
    @Param('chantierId') chantierId: string,
    @Param('mouvementId') mouvementId: string,
  ) {
    return this.budget.supprimerMouvement(chantierId, mouvementId);
  }
}
