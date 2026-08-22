import {
  BadRequestException, Body, Controller, Get, Param, Patch, Post, Query,
} from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import {
  ArticleInput, DepotInput, EntreeInput, SortieInput, StockService, TransfertInput,
} from './stock.service';

@Controller()
export class StockController {
  constructor(private readonly stock: StockService) {}

  /* ─── Dépôts ─── */

  @Get('stock/depots')
  @RequiresCapability('stock')
  @RequiresPermission('site_tracking.read')
  listDepots() {
    return this.stock.listDepots();
  }

  @Post('stock/depots')
  @RequiresCapability('stock')
  @RequiresPermission('site_tracking.write')
  creerDepot(@Body() body: DepotInput) {
    return this.stock.creerDepot(body ?? ({} as DepotInput));
  }

  /* ─── Articles ─── */

  @Post('stock/articles')
  @RequiresCapability('stock')
  @RequiresPermission('site_tracking.write')
  creerArticle(@Body() body: ArticleInput) {
    return this.stock.creerArticle(body ?? ({} as ArticleInput));
  }

  @Patch('stock/articles/:articleId')
  @RequiresCapability('stock')
  @RequiresPermission('site_tracking.write')
  majArticle(@Param('articleId') articleId: string, @Body() body: Partial<ArticleInput>) {
    return this.stock.majArticle(articleId, body ?? {});
  }

  /* ─── État et journal ─── */

  /** L'état du stock : ce qui reste, par dépôt, et ce que ça vaut au prix moyen pondéré. */
  @Get('stock/etat')
  @RequiresCapability('stock')
  @RequiresPermission('site_tracking.read')
  etat(@Query('depot') depot?: string) {
    return this.stock.etat(depot || null);
  }

  @Get('stock/mouvements')
  @RequiresCapability('stock')
  @RequiresPermission('site_tracking.read')
  mouvements(
    @Query('article') article?: string,
    @Query('depot') depot?: string,
    @Query('chantier') chantier?: string,
  ) {
    return this.stock.mouvements({
      articleId: article || null, depotId: depot || null, chantierId: chantier || null,
    });
  }

  /* ─── Mouvements ─── */

  @Post('stock/entrees')
  @RequiresCapability('stock')
  @RequiresPermission('site_tracking.write')
  entree(@Body() body: EntreeInput) {
    if (!body?.articleId || !body?.depotId) {
      throw new BadRequestException('L’article et le dépôt sont obligatoires.');
    }
    return this.stock.entree(body);
  }

  @Post('stock/sorties')
  @RequiresCapability('stock')
  @RequiresPermission('site_tracking.write')
  sortie(@Body() body: SortieInput) {
    if (!body?.articleId || !body?.depotId) {
      throw new BadRequestException('L’article et le dépôt sont obligatoires.');
    }
    return this.stock.sortie(body);
  }

  @Post('stock/transferts')
  @RequiresCapability('stock')
  @RequiresPermission('site_tracking.write')
  transfert(@Body() body: TransfertInput) {
    if (!body?.articleId || !body?.depotId || !body?.depotCibleId) {
      throw new BadRequestException('L’article, le dépôt d’origine et celui d’arrivée sont obligatoires.');
    }
    return this.stock.transfert(body);
  }
}
