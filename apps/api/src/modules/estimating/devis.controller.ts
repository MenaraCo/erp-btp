import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { DataGridQuery } from '../../core/common/data-grid/data-grid';
import {
  AffaireInput,
  AffairePatch,
  DevisInput,
  DevisLineInput,
  DevisPatch,
  DevisService,
} from './devis.service';

@Controller()
export class DevisController {
  constructor(private readonly devis: DevisService) {}

  @Post('affaires')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  createAffaire(@Body() body: AffaireInput) {
    if (!body?.code || !body?.name) {
      throw new BadRequestException('code and name are required');
    }
    return this.devis.createAffaire(body);
  }

  @Get('affaires')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  listAffaires(@Query() query: DataGridQuery) {
    return this.devis.listAffaires(query);
  }

  @Get('affaires/:affaireId')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  getAffaire(@Param('affaireId') affaireId: string) {
    return this.devis.getAffaire(affaireId);
  }

  @Patch('affaires/:affaireId')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  updateAffaire(@Param('affaireId') affaireId: string, @Body() body: AffairePatch) {
    return this.devis.updateAffaire(affaireId, body ?? {});
  }

  @Patch('devis/:devisId')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  updateDevis(@Param('devisId') devisId: string, @Body() body: DevisPatch) {
    return this.devis.updateDevis(devisId, body ?? {});
  }

  @Post('affaires/:affaireId/devis')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  createDevis(@Param('affaireId') affaireId: string, @Body() body: DevisInput) {
    if (!body?.designation) {
      throw new BadRequestException('designation is required');
    }
    return this.devis.createDevis(affaireId, body);
  }

  @Get('devis/:devisId')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  getDevis(@Param('devisId') devisId: string) {
    return this.devis.getDevis(devisId);
  }

  @Post('devis/:devisId/versions')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  createVersion(@Param('devisId') devisId: string, @Body() body: { label?: string }) {
    return this.devis.createVersion(devisId, body?.label);
  }

  @Post('versions/:versionId/lines')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  addLine(@Param('versionId') versionId: string, @Body() body: DevisLineInput) {
    if (!body?.type || !body?.designation) {
      throw new BadRequestException('type and designation are required');
    }
    return this.devis.addLine(versionId, body);
  }

  @Get('versions/:versionId/lines')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  listLines(@Param('versionId') versionId: string) {
    return this.devis.listLines(versionId);
  }

  @Put('versions/:versionId/variables/:name')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  setVariable(
    @Param('versionId') versionId: string,
    @Param('name') name: string,
    @Body() body: { value?: string | number },
  ) {
    if (body?.value == null || Number.isNaN(Number(body.value))) {
      throw new BadRequestException('value is required');
    }
    return this.devis.setVariable(versionId, name, body.value);
  }
}
