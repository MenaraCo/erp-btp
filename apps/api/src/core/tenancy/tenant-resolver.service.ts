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

    // Dev convenience: resolve by slug header (the web app knows the slug, not the UUID).
    const slugHeader = req.headers['x-tenant-slug'];
    if (slugHeader) {
      const value = Array.isArray(slugHeader) ? slugHeader[0] : slugHeader;
      const id = await this.findIdBySlug(value);
      if (!id) {
        throw new NotFoundException(`Unknown tenant slug "${value}"`);
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

  /** Normalisation identique à l'allocation du slug à l'inscription (nom société → slug). */
  private toSlug(input: string): string {
    return input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  /**
   * Résolution TOLÉRANTE de l'entreprise. Le slug est dérivé du nom de société à l'inscription et
   * jamais choisi explicitement : au login, l'utilisateur ne connaît souvent que le NOM de sa
   * société. On accepte donc le slug exact, le nom normalisé comme à l'inscription, ou le nom tel
   * quel. Le mot de passe reste le vrai garde-fou (une résolution vers une homonyme échoue au
   * contrôle du mot de passe, sans faille de sécurité).
   */
  private async findIdBySlug(input: string): Promise<string | null> {
    const raw = (input ?? '').trim();
    if (!raw) return null;
    const normalized = this.toSlug(raw);
    const rows = await this.dataSource.query(
      `SELECT id FROM tenant
         WHERE slug = $1 OR slug = $2 OR lower(name) = lower($1)
         ORDER BY (slug = $1) DESC, (slug = $2) DESC
         LIMIT 1`,
      [raw, normalized],
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
