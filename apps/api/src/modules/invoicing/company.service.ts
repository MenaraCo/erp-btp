import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { patternHasSequence } from './chrono';

export interface CompanyInput {
  code: string;
  name: string;
  siren?: string | null;
  vatNumber?: string | null;
}

@Injectable()
export class CompanyService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  createCompany(input: CompanyInput) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em
        .query(
          `INSERT INTO company (tenant_id, code, name, siren, vat_number)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [tenantId, input.code, input.name, input.siren ?? null, input.vatNumber ?? null],
        )
        .then((r) => r[0]),
    );
  }

  listCompanies() {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.query(`SELECT * FROM company ORDER BY code ASC`),
    );
  }

  /**
   * Configures the invoice chrono pattern for a company. Allowed only before the first invoice
   * is issued — once locked, the montage is frozen (cahier des charges §5.6).
   */
  setChrono(companyId: string, pattern: string) {
    const tenantId = this.context.requireTenantId();
    if (!patternHasSequence(pattern)) {
      throw new BadRequestException('The chrono pattern must contain a {SEQ} token.');
    }
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const company = await em.query(`SELECT id FROM company WHERE id = $1`, [companyId]);
      if (company.length === 0) {
        throw new NotFoundException(`Unknown company "${companyId}"`);
      }
      const existing = await em.query(
        `SELECT locked FROM invoice_chrono WHERE company_id = $1 FOR UPDATE`,
        [companyId],
      );
      if (existing.length > 0 && existing[0].locked) {
        throw new ConflictException(
          'The invoice chrono is frozen (a first invoice has already been issued).',
        );
      }
      return (
        await em.query(
          `INSERT INTO invoice_chrono (tenant_id, company_id, pattern, next_seq, locked)
           VALUES ($1, $2, $3, 1, false)
           ON CONFLICT (company_id)
           DO UPDATE SET pattern = EXCLUDED.pattern, next_seq = 1, updated_at = now()
           RETURNING *`,
          [tenantId, companyId, pattern],
        )
      )[0];
    });
  }

  getChrono(companyId: string) {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(`SELECT * FROM invoice_chrono WHERE company_id = $1`, [
        companyId,
      ]);
      if (rows.length === 0) {
        throw new NotFoundException(`No chrono configured for company "${companyId}"`);
      }
      return rows[0];
    });
  }
}
