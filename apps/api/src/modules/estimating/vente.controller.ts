import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { FraisAnnexeInput, SaleSheetInput, VenteService } from './vente.service';

@Controller('versions/:versionId')
export class VenteController {
  constructor(private readonly vente: VenteService) {}

  @Put('sale-sheet')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  setSaleSheet(@Param('versionId') versionId: string, @Body() body: SaleSheetInput) {
    if (!body?.byNature) {
      throw new BadRequestException('byNature coefficients are required');
    }
    return this.vente.setSaleSheet(versionId, body);
  }

  @Get('sale-sheet')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  compute(@Param('versionId') versionId: string) {
    return this.vente.computeForVersion(versionId);
  }

  @Put('frais-annexes')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  setFraisAnnexes(
    @Param('versionId') versionId: string,
    @Body() body: { frais?: FraisAnnexeInput[] },
  ) {
    if (!Array.isArray(body?.frais)) {
      throw new BadRequestException('frais must be an array');
    }
    return this.vente.setFraisAnnexes(versionId, body.frais);
  }

  @Put('lines/:lineId/pv')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  setLinePv(
    @Param('lineId') lineId: string,
    @Body() body: { puVente?: number | string | null; force?: boolean },
  ) {
    const force = body?.force ?? false;
    if (force && (body?.puVente == null || Number.isNaN(Number(body.puVente)))) {
      throw new BadRequestException('puVente is required when force is true');
    }
    return this.vente.setLinePv(lineId, force ? body.puVente! : null, force);
  }
}
