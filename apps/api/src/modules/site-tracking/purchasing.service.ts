import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  assertTransition,
  InvalidPoTransitionError,
  PurchaseOrderStatus,
} from './purchase-order-status';

export interface OrderLineInput {
  executionLineId?: string | null;
  nature: string;
  designation: string;
  quantity: string | number;
  unitPrice: string | number;
  /** Analytical imputation (famille → lot → nature) for the engagé axis (cahier §5.8). */
  familleAnalytiqueId?: string | null;
}

export interface SupplierInvoiceInput {
  code: string;
  nature: string;
  amountHt: string | number;
  invoiceDate?: string;
  /** Analytical imputation (famille → lot → nature) for the réalisé axis (cahier §5.8). */
  familleAnalytiqueId?: string | null;
}

@Injectable()
export class PurchasingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  // --- DDP (demande de prix) ---

  createRequest(chantierId: string, input: { code: string; supplierId?: string | null }) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      return (
        await em.query(
          `INSERT INTO purchase_request (tenant_id, chantier_id, supplier_id, code)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [tenantId, chantierId, input.supplierId ?? null, input.code],
        )
      )[0];
    });
  }

  convertRequest(requestId: string, code: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const req = await em.query(`SELECT * FROM purchase_request WHERE id = $1`, [requestId]);
      if (req.length === 0) {
        throw new NotFoundException(`Unknown purchase request "${requestId}"`);
      }
      const order = (
        await em.query(
          `INSERT INTO purchase_order (tenant_id, chantier_id, request_id, supplier_id, code)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [tenantId, req[0].chantier_id, requestId, req[0].supplier_id, code],
        )
      )[0];
      await em.query(`UPDATE purchase_request SET status = 'converted', updated_at = now() WHERE id = $1`, [requestId]);
      return order;
    });
  }

  // --- BC (bon de commande) ---

  createOrder(chantierId: string, input: { code: string; supplierId?: string | null }) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.assertChantier(em, chantierId);
      return (
        await em.query(
          `INSERT INTO purchase_order (tenant_id, chantier_id, supplier_id, code)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [tenantId, chantierId, input.supplierId ?? null, input.code],
        )
      )[0];
    });
  }

  addLine(orderId: string, input: OrderLineInput) {
    const tenantId = this.context.requireTenantId();
    const qty = new Decimal(input.quantity ?? 0);
    const price = new Decimal(input.unitPrice ?? 0);
    const amount = qty.times(price).toDecimalPlaces(2);
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const order = await em.query(`SELECT status FROM purchase_order WHERE id = $1`, [orderId]);
      if (order.length === 0) {
        throw new NotFoundException(`Unknown purchase order "${orderId}"`);
      }
      if (order[0].status !== 'draft') {
        throw new ConflictException('Lines can only be added to a draft order.');
      }
      if (input.familleAnalytiqueId != null) {
        await this.assertFamilleExists(em, input.familleAnalytiqueId);
      }
      const line = (
        await em.query(
          `INSERT INTO purchase_order_line
             (tenant_id, order_id, execution_line_id, nature, designation, quantity, unit_price, amount_ht, famille_analytique_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [tenantId, orderId, input.executionLineId ?? null, input.nature, input.designation,
            qty.toString(), price.toString(), amount.toString(), input.familleAnalytiqueId ?? null],
        )
      )[0];
      await em.query(
        `UPDATE purchase_order SET total_ht = (SELECT COALESCE(SUM(amount_ht),0) FROM purchase_order_line WHERE order_id = $1),
           updated_at = now() WHERE id = $1`,
        [orderId],
      );
      return line;
    });
  }

  validateOrder(orderId: string) {
    return this.transition(orderId, 'validated', true);
  }

  cancelOrder(orderId: string) {
    return this.transition(orderId, 'cancelled', false);
  }

  private transition(orderId: string, to: PurchaseOrderStatus, setValidatedAt: boolean) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT status FROM purchase_order WHERE id = $1 FOR UPDATE`, [orderId]);
      if (rows.length === 0) {
        throw new NotFoundException(`Unknown purchase order "${orderId}"`);
      }
      try {
        assertTransition(rows[0].status, to);
      } catch (e) {
        if (e instanceof InvalidPoTransitionError) {
          throw new ConflictException(e.message);
        }
        throw e;
      }
      await em.query(
        `UPDATE purchase_order SET status = $1${setValidatedAt ? ', validated_at = now()' : ''}, updated_at = now() WHERE id = $2`,
        [to, orderId],
      );
      return (await em.query(`SELECT * FROM purchase_order WHERE id = $1`, [orderId]))[0];
    });
  }

  // --- BL (bon de livraison) ---

  receiveDelivery(orderId: string, code: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const order = await em.query(`SELECT status FROM purchase_order WHERE id = $1`, [orderId]);
      if (order.length === 0) {
        throw new NotFoundException(`Unknown purchase order "${orderId}"`);
      }
      if (order[0].status !== 'validated') {
        throw new ConflictException('Deliveries require a validated order.');
      }
      return (
        await em.query(
          `INSERT INTO delivery_note (tenant_id, order_id, code) VALUES ($1,$2,$3) RETURNING *`,
          [tenantId, orderId, code],
        )
      )[0];
    });
  }

  // --- Facture fournisseur ---

  addSupplierInvoice(orderId: string, input: SupplierInvoiceInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const order = await em.query(`SELECT chantier_id, status FROM purchase_order WHERE id = $1`, [orderId]);
      if (order.length === 0) {
        throw new NotFoundException(`Unknown purchase order "${orderId}"`);
      }
      if (order[0].status !== 'validated') {
        throw new ConflictException('Supplier invoices require a validated order.');
      }
      if (input.familleAnalytiqueId != null) {
        await this.assertFamilleExists(em, input.familleAnalytiqueId);
      }
      return (
        await em.query(
          `INSERT INTO supplier_invoice (tenant_id, chantier_id, order_id, code, nature, amount_ht, invoice_date, famille_analytique_id)
           VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, now()), $8) RETURNING *`,
          [tenantId, order[0].chantier_id, orderId, input.code, input.nature,
            new Decimal(input.amountHt ?? 0).toDecimalPlaces(2).toString(), input.invoiceDate ?? null,
            input.familleAnalytiqueId ?? null],
        )
      )[0];
    });
  }

  private async assertFamilleExists(em: EntityManager, familleId: string): Promise<void> {
    const rows = await em.query(`SELECT id FROM analytical_famille WHERE id = $1`, [familleId]);
    if (rows.length === 0) {
      throw new NotFoundException(`Unknown famille analytique "${familleId}"`);
    }
  }

  /** Engagé (validated orders) and réalisé achats (supplier invoices), by nature, for a chantier. */
  summary(chantierId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const engageByNature = await em.query(
        `SELECT l.nature, SUM(l.amount_ht)::numeric(16,2) AS montant
           FROM purchase_order_line l JOIN purchase_order o ON o.id = l.order_id
          WHERE o.chantier_id = $1 AND o.status = 'validated'
          GROUP BY l.nature ORDER BY l.nature`,
        [chantierId],
      );
      const realiseByNature = await em.query(
        `SELECT nature, SUM(amount_ht)::numeric(16,2) AS montant
           FROM supplier_invoice WHERE chantier_id = $1 GROUP BY nature ORDER BY nature`,
        [chantierId],
      );
      const engageTotal = engageByNature.reduce((a: Decimal, r: { montant: string }) => a.plus(r.montant), new Decimal(0));
      const realiseTotal = realiseByNature.reduce((a: Decimal, r: { montant: string }) => a.plus(r.montant), new Decimal(0));
      return {
        engageByNature,
        realiseByNature,
        engageTotal: engageTotal.toFixed(2),
        realiseTotal: realiseTotal.toFixed(2),
      };
    });
  }

  private async assertChantier(em: EntityManager, chantierId: string): Promise<void> {
    const c = await em.query(`SELECT id FROM chantier WHERE id = $1`, [chantierId]);
    if (c.length === 0) {
      throw new NotFoundException(`Unknown chantier "${chantierId}"`);
    }
  }
}
