import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { formatChrono } from './chrono';

export interface GenerateInvoiceInput {
  companyId: string;
  tpf?: string | number;
}

@Injectable()
export class InvoiceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  /** Generates an invoice from a situation, numbered via the company chrono (freezing it). */
  generateFromSituation(situationId: string, input: GenerateInvoiceInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const situation = await em.query(
        `SELECT montant_periode_ht, tva FROM situation WHERE id = $1`,
        [situationId],
      );
      if (situation.length === 0) {
        throw new NotFoundException(`Unknown situation "${situationId}"`);
      }

      const dup = await em.query(`SELECT id FROM invoice WHERE situation_id = $1`, [
        situationId,
      ]);
      if (dup.length > 0) {
        throw new ConflictException('This situation has already been invoiced.');
      }

      // Lock the chrono row to serialise numbering and freeze it.
      const chrono = await em.query(
        `SELECT id, pattern, next_seq FROM invoice_chrono WHERE company_id = $1 FOR UPDATE`,
        [input.companyId],
      );
      if (chrono.length === 0) {
        throw new BadRequestException(
          'Configure the invoice chrono for this company before invoicing.',
        );
      }

      const seq = Number(chrono[0].next_seq);
      const numero = formatChrono(chrono[0].pattern, seq);

      const ht = new Decimal(situation[0].montant_periode_ht);
      const tva = new Decimal(situation[0].tva);
      const tpf = new Decimal(input.tpf ?? 0);
      const ttc = ht.plus(tva).plus(tpf).toDecimalPlaces(2);

      const invoice = (
        await em.query(
          `INSERT INTO invoice
             (tenant_id, company_id, situation_id, numero, montant_ht, tva, tpf, ttc)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            tenantId,
            input.companyId,
            situationId,
            numero,
            ht.toFixed(2),
            tva.toFixed(2),
            tpf.toFixed(2),
            ttc.toString(),
          ],
        )
      )[0];

      await em.query(
        `UPDATE invoice_chrono SET next_seq = $1, locked = true, updated_at = now() WHERE id = $2`,
        [seq + 1, chrono[0].id],
      );

      return invoice;
    });
  }

  getInvoice(invoiceId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT * FROM invoice WHERE id = $1`, [invoiceId]);
      if (rows.length === 0) {
        throw new NotFoundException(`Unknown invoice "${invoiceId}"`);
      }
      return rows[0];
    });
  }

  listByCompany(companyId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM invoice WHERE company_id = $1 ORDER BY created_at ASC`, [
        companyId,
      ]),
    );
  }
}
