import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { CII_GUIDELINE_EN16931, COMPLIANCE_VERSION } from './compliance.config';
import {
  assertTransition,
  EInvoiceStatus,
  InvalidEInvoiceTransitionError,
  isEInvoiceStatus,
} from './einvoice-status';

@Injectable()
export class EInvoiceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  get(invoiceId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.ensure(em, tenantId, invoiceId);
      const rows = await em.query(`SELECT * FROM einvoice WHERE invoice_id = $1`, [invoiceId]);
      return rows[0];
    });
  }

  /** Chorus Pro deposit (stub — no network): issued -> submitted with a deposit reference. */
  submitToChorusPro(invoiceId: string) {
    return this.changeStatus(invoiceId, 'submitted', () => `CPRO-${randomBytes(6).toString('hex')}`);
  }

  /** Advance the e-invoice status through the lifecycle state machine. */
  transition(invoiceId: string, to: string) {
    if (!isEInvoiceStatus(to)) {
      throw new BadRequestException(`Unknown e-invoice status "${to}"`);
    }
    return this.changeStatus(invoiceId, to);
  }

  private changeStatus(
    invoiceId: string,
    to: EInvoiceStatus,
    chorusRef?: () => string,
  ) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      await this.ensure(em, tenantId, invoiceId);
      const rows = await em.query(
        `SELECT status FROM einvoice WHERE invoice_id = $1 FOR UPDATE`,
        [invoiceId],
      );
      const from = rows[0].status as EInvoiceStatus;
      try {
        assertTransition(from, to);
      } catch (e) {
        if (e instanceof InvalidEInvoiceTransitionError) {
          throw new ConflictException(e.message);
        }
        throw e;
      }
      await em.query(
        `UPDATE einvoice SET status = $1, chorus_pro_ref = COALESCE($2, chorus_pro_ref), updated_at = now()
          WHERE invoice_id = $3`,
        [to, chorusRef ? chorusRef() : null, invoiceId],
      );
      return (await em.query(`SELECT * FROM einvoice WHERE invoice_id = $1`, [invoiceId]))[0];
    });
  }

  private async ensure(em: EntityManager, tenantId: string, invoiceId: string): Promise<void> {
    const invoice = await em.query(`SELECT id FROM invoice WHERE id = $1`, [invoiceId]);
    if (invoice.length === 0) {
      throw new NotFoundException(`Unknown invoice "${invoiceId}"`);
    }
    await em.query(
      `INSERT INTO einvoice (tenant_id, invoice_id, status, cii_profile, compliance_version)
       VALUES ($1, $2, 'issued', $3, $4)
       ON CONFLICT (invoice_id) DO NOTHING`,
      [tenantId, invoiceId, CII_GUIDELINE_EN16931, COMPLIANCE_VERSION],
    );
  }
}
