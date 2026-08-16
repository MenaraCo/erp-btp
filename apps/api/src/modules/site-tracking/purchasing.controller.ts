import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { OrderLineInput, PurchasingService } from './purchasing.service';
import { ApprovisionnementService } from './approvisionnement.service';
import { AchatsRegistreService, FiltreRegistre } from './achats-registre.service';

const NATURES = ['labor', 'material', 'equipment', 'subcontract', 'site_overhead'];

/** Traduit les paramètres d'URL du registre en filtre — un seul endroit qui connaît leurs noms. */
function filtreDepuis(query: Record<string, string>): FiltreRegistre {
  return {
    q: query.q ?? null,
    chantierId: query.chantier ?? null,
    supplierId: query.fournisseur ?? null,
    statut: query.statut ?? null,
    du: query.du ?? null,
    au: query.au ?? null,
    montantMin: query.min ?? null,
    montantMax: query.max ?? null,
    page: query.page ? Number(query.page) : 1,
    parPage: query.parPage ? Number(query.parPage) : undefined,
  };
}

@Controller()
export class PurchasingController {
  constructor(
    private readonly purchasing: PurchasingService,
    private readonly appro: ApprovisionnementService,
    private readonly registre: AchatsRegistreService,
  ) {}

  // --- Registre d'entreprise : retrouver une pièce, tous chantiers confondus ---

  @Get('achats/commandes')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  registreCommandes(@Query() query: Record<string, string>) {
    return this.registre.commandes(filtreDepuis(query));
  }

  @Get('achats/receptions')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  registreReceptions(@Query() query: Record<string, string>) {
    return this.registre.receptions(filtreDepuis(query));
  }

  @Get('achats/factures')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  registreFactures(@Query() query: Record<string, string>) {
    return this.registre.factures(filtreDepuis(query));
  }

  /** Fiche d'une commande : en-tête, lignes, réceptions, factures. */
  @Get('purchase-orders/:orderId')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  order(@Param('orderId') orderId: string) {
    return this.purchasing.getOrder(orderId);
  }

  // DDP
  @Post('chantiers/:chantierId/purchase-requests')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  createRequest(@Param('chantierId') chantierId: string, @Body() body: { code?: string; supplierId?: string }) {
    return this.purchasing.createRequest(chantierId, { code: body.code, supplierId: body.supplierId });
  }

  @Post('purchase-requests/:requestId/convert')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  convert(@Param('requestId') requestId: string, @Body() body: { code?: string }) {
    return this.purchasing.convertRequest(requestId, body.code);
  }

  // BC
  @Post('chantiers/:chantierId/purchase-orders')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  createOrder(@Param('chantierId') chantierId: string, @Body() body: { code?: string; supplierId?: string }) {
    return this.purchasing.createOrder(chantierId, { code: body.code, supplierId: body.supplierId });
  }

  @Post('purchase-orders/:orderId/lines')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  addLine(@Param('orderId') orderId: string, @Body() body: OrderLineInput) {
    if (!body?.nature || !NATURES.includes(body.nature) || !body?.designation) {
      throw new BadRequestException('nature (valid) and designation are required');
    }
    return this.purchasing.addLine(orderId, body);
  }

  /** Ce qu'il reste à approvisionner, ressource par ressource — la base d'une commande. */
  @Get('chantiers/:chantierId/approvisionnement')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  approvisionnement(
    @Param('chantierId') chantierId: string,
    @Query('fournisseur') supplierId?: string,
    @Query('lot') lotId?: string,
    @Query('famille') familleId?: string,
    @Query('code') codeAnalytiqueId?: string,
    @Query('nature') nature?: string,
    @Query('reste') reste?: string,
  ) {
    return this.appro.suggestions(chantierId, {
      supplierId, lotId, familleId, codeAnalytiqueId, nature,
      resteSeulement: reste === '1' || reste === 'true',
    });
  }

  /** Fournisseurs, lots et familles présents sur le chantier — pour commander par paquets. */
  @Get('chantiers/:chantierId/approvisionnement/regroupements')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  regroupements(@Param('chantierId') chantierId: string) {
    return this.appro.regroupements(chantierId);
  }

  /** Insère les ressources choisies dans la commande, en unité d'achat. */
  @Post('purchase-orders/:orderId/lines/nomenclature')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  insererDepuisNomenclature(
    @Param('orderId') orderId: string,
    @Body() body: {
      resourceIds?: string[];
      mode?: 'total' | 'avancement' | 'reste';
      filtre?: {
        supplierId?: string | null; lotId?: string | null; familleId?: string | null;
        codeAnalytiqueId?: string | null; nature?: string | null; resteSeulement?: boolean;
      };
    },
  ) {
    return this.appro.insererDepuisNomenclature(orderId, body ?? {});
  }

  @Get('purchase-orders/:orderId/lines')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  lines(@Param('orderId') orderId: string) {
    return this.purchasing.listLines(orderId);
  }

  @Post('purchase-orders/:orderId/validate')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  validate(@Param('orderId') orderId: string) {
    return this.purchasing.validateOrder(orderId);
  }

  /**
   * Réouverture d'une commande envoyée — le droit `rbac.role.manage` sert de marqueur
   * d'administration : seul un administrateur le détient dans les rôles système.
   */
  @Post('purchase-orders/:orderId/reopen')
  @RequiresCapability('purchasing')
  @RequiresPermission('rbac.role.manage')
  reopen(@Param('orderId') orderId: string, @Body() body: { motif?: string }) {
    return this.purchasing.reopenOrder(orderId, body?.motif ?? '');
  }

  /** Journal d'une commande : validation, annulation, réouverture. */
  @Get('purchase-orders/:orderId/events')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  events(@Param('orderId') orderId: string) {
    return this.purchasing.listEvents(orderId);
  }

  @Post('purchase-orders/:orderId/cancel')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  cancel(@Param('orderId') orderId: string) {
    return this.purchasing.cancelOrder(orderId);
  }

  // BL
  @Post('purchase-orders/:orderId/delivery-notes')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  receive(@Param('orderId') orderId: string, @Body() body: { code?: string }) {
    return this.purchasing.receiveDelivery(orderId, body?.code);
  }

  // Facture fournisseur
  @Post('purchase-orders/:orderId/invoices')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  invoice(
    @Param('orderId') orderId: string,
    @Body()
    body: {
      code?: string;
      nature?: string;
      amountHt?: string | number;
      invoiceDate?: string;
      executionLineId?: string | null;
      codeAnalytiqueId?: string | null;
    },
  ) {
    if (!body?.code || !body?.nature || !NATURES.includes(body.nature) || body?.amountHt == null) {
      throw new BadRequestException('code, nature (valid) and amountHt are required');
    }
    return this.purchasing.addSupplierInvoice(orderId, {
      code: body.code,
      nature: body.nature,
      amountHt: body.amountHt,
      invoiceDate: body.invoiceDate,
      executionLineId: body.executionLineId,
      codeAnalytiqueId: body.codeAnalytiqueId,
    });
  }

  @Get('chantiers/:chantierId/purchasing-summary')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  summary(@Param('chantierId') chantierId: string) {
    return this.purchasing.summary(chantierId);
  }

  /** Chaîne des achats du chantier : demandes de prix et commandes détaillées (écran de suivi). */
  @Get('chantiers/:chantierId/purchasing-chain')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  chain(@Param('chantierId') chantierId: string) {
    return this.purchasing.listChain(chantierId);
  }
}
