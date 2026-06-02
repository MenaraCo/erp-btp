import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { SaleSheetInput, VenteService } from './vente.service';

@Controller('versions/:versionId/sale-sheet')
export class VenteController {
  constructor(private readonly vente: VenteService) {}

  @Put()
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  setSaleSheet(@Param('versionId') versionId: string, @Body() body: SaleSheetInput) {
    if (!body?.byNature) {
      throw new BadRequestException('byNature coefficients are required');
    }
    return this.vente.setSaleSheet(versionId, body);
  }

  @Get()
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  compute(@Param('versionId') versionId: string) {
    return this.vente.computeForVersion(versionId);
  }
}
