import { BadRequestException, Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { FinancialConfigService, FormulaSetInput } from './financial-config.service';
import { AdvancementInput, AdvancementService } from './advancement.service';
import { AnalyticalResultsService } from './analytical-results.service';
import { FinancialForecastService } from './financial-forecast.service';

@Controller()
export class FinancialController {
  constructor(
    private readonly config: FinancialConfigService,
    private readonly advancement: AdvancementService,
    private readonly analyticalResults: AnalyticalResultsService,
    private readonly forecast: FinancialForecastService,
  ) {}

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
}
