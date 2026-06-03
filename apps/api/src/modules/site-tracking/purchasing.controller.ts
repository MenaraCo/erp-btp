import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequiresCapability } from '../../core/entitlements/requires-capability.decorator';
import { RequiresPermission } from '../../core/rbac/requires-permission.decorator';
import { OrderLineInput, PurchasingService } from './purchasing.service';

const NATURES = ['labor', 'material', 'equipment', 'subcontract', 'site_overhead'];

@Controller()
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  // DDP
  @Post('chantiers/:chantierId/purchase-requests')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  createRequest(@Param('chantierId') chantierId: string, @Body() body: { code?: string; supplierId?: string }) {
    if (!body?.code) throw new BadRequestException('code is required');
    return this.purchasing.createRequest(chantierId, { code: body.code, supplierId: body.supplierId });
  }

  @Post('purchase-requests/:requestId/convert')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  convert(@Param('requestId') requestId: string, @Body() body: { code?: string }) {
    if (!body?.code) throw new BadRequestException('code is required');
    return this.purchasing.convertRequest(requestId, body.code);
  }

  // BC
  @Post('chantiers/:chantierId/purchase-orders')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  createOrder(@Param('chantierId') chantierId: string, @Body() body: { code?: string; supplierId?: string }) {
    if (!body?.code) throw new BadRequestException('code is required');
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

  @Post('purchase-orders/:orderId/validate')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.write')
  validate(@Param('orderId') orderId: string) {
    return this.purchasing.validateOrder(orderId);
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
    if (!body?.code) throw new BadRequestException('code is required');
    return this.purchasing.receiveDelivery(orderId, body.code);
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
      codeAnalytiqueId: body.codeAnalytiqueId,
    });
  }

  @Get('chantiers/:chantierId/purchasing-summary')
  @RequiresCapability('purchasing')
  @RequiresPermission('site_tracking.read')
  summary(@Param('chantierId') chantierId: string) {
    return this.purchasing.summary(chantierId);
  }
}
