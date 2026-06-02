import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { DataGridQuery } from '../../core/common/data-grid/data-grid';
import { AffaireInput, DevisLineInput, DevisService } from './devis.service';

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

  @Post('affaires/:affaireId/versions')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.write')
  createVersion(@Param('affaireId') affaireId: string, @Body() body: { label?: string }) {
    return this.devis.createVersion(affaireId, body?.label);
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
