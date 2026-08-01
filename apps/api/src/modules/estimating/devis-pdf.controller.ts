import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { DevisPdfService } from './devis-pdf.service';

@Controller('versions/:versionId')
export class DevisPdfController {
  constructor(private readonly pdf: DevisPdfService) {}

  @Get('devis.pdf')
  @RequiresCapability('estimating.bid')
  @RequiresPermission('estimating.devis.read')
  async devisPdf(
    @Param('versionId') versionId: string,
    @Res() res: Response,
    /** bordereau=1 : édition d'appel d'offre — prix laissés à remplir par le soumissionnaire. */
    @Query('bordereau') bordereau?: string,
  ) {
    const buffer = await this.pdf.generate(versionId, { bordereau: bordereau === '1' });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="devis-${versionId}.pdf"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }
}
