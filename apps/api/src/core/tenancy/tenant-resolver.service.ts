import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Request } from 'express';
import { loadAppConfig } from '../../config/env.config';
import { extractTenantSlugFromHost } from './tenant-host.util';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the current tenant from a request, sub-domain first then the X-Tenant-Id header.
 * Returns null when neither is present (the middleware decides whether that is acceptable).
 * Throws NotFoundException when a sub-domain/header points at an unknown tenant.
 */
@Injectable()
export class TenantResolverService {
  private readonly baseDomain = loadAppConfig().tenantBaseDomain;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async resolve(req: Request): Promise<string | null> {
    const slug = extractTenantSlugFromHost(req.headers.host, this.baseDomain);
    if (slug) {
      const id = await this.findIdBySlug(slug);
      if (!id) {
        throw new NotFoundException(`Unknown tenant for sub-domain "${slug}"`);
      }
      return id;
    }

    const header = req.headers['x-tenant-id'];
    if (header) {
      const tenantId = Array.isArray(header) ? header[0] : header;
      if (!UUID_RE.test(tenantId) || !(await this.exists(tenantId))) {
        throw new NotFoundException(`Unknown tenant "${tenantId}"`);
      }
      return tenantId;
    }

    return null;
  }

  private async findIdBySlug(slug: string): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT id FROM tenant WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    return rows[0]?.id ?? null;
  }

  private async exists(tenantId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM tenant WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    return rows.length > 0;
  }
}
