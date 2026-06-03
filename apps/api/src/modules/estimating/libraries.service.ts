import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  DataGridQuery,
  PaginatedResult,
  paginate,
} from '../../core/common/data-grid/data-grid';
import { LibraryEntity } from './entities/library.entity';
import { ResourceEntity, ResourceNature } from './entities/resource.entity';
import { OuvragesService } from './ouvrages.service';

export interface LibraryInput {
  code: string;
  name: string;
  description?: string | null;
}

export interface ResourceInput {
  code: string;
  label: string;
  unit: string;
  nature: ResourceNature;
  unitCost: string | number;
  output?: string | number | null;
  /** Code produit unique société (défaut = `code`). */
  codeProduit?: string | null;
  /** Rattachement optionnel à un code analytique du plan (cahier §5.8). */
  codeAnalytiqueId?: string | null;
}

@Injectable()
export class LibrariesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
    private readonly ouvrages: OuvragesService,
  ) {}

  /** Updates a resource's déboursé unitaire and recomputes every dependent ouvrage (rule #1). */
  async updateResourceCost(
    libraryId: string,
    resourceId: string,
    unitCost: string | number,
  ): Promise<ResourceEntity> {
    const tenantId = this.context.requireTenantId();
    const updated = await runInTenant(this.dataSource, tenantId, async (em) => {
      const existing = await em.query(
        `SELECT id FROM resource WHERE id = $1 AND library_id = $2`,
        [resourceId, libraryId],
      );
      if (existing.length === 0) {
        throw new NotFoundException(`Unknown resource "${resourceId}"`);
      }
      await em.query(`UPDATE resource SET unit_cost = $1, updated_at = now() WHERE id = $2`, [
        String(unitCost),
        resourceId,
      ]);
      return (await em.query(`SELECT * FROM resource WHERE id = $1`, [resourceId]))[0];
    });
    await this.ouvrages.recomputeTenant();
    return updated;
  }

  createLibrary(input: LibraryInput): Promise<LibraryEntity> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.getRepository(LibraryEntity).save(
        em.getRepository(LibraryEntity).create({ ...input, tenantId }),
      ),
    );
  }

  listLibraries(query: DataGridQuery): Promise<PaginatedResult<LibraryEntity>> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      paginate(em.getRepository(LibraryEntity).createQueryBuilder('p'), query, {
        alias: 'p',
        sortable: ['code', 'name', 'createdAt'],
        searchable: ['code', 'name'],
        defaultSort: 'code',
      }),
    );
  }

  createResource(libraryId: string, input: ResourceInput): Promise<ResourceEntity> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const library = await em.getRepository(LibraryEntity).findOne({
        where: { id: libraryId },
      });
      if (!library) {
        throw new NotFoundException(`Unknown library "${libraryId}"`);
      }
      if (input.codeAnalytiqueId != null) {
        await this.assertCodeAnalytiqueExists(em, input.codeAnalytiqueId);
      }
      const repo = em.getRepository(ResourceEntity);
      return repo.save(
        repo.create({
          tenantId,
          libraryId,
          code: input.code,
          label: input.label,
          unit: input.unit,
          nature: input.nature,
          unitCost: String(input.unitCost),
          output: input.output == null ? null : String(input.output),
          codeProduit: input.codeProduit ?? input.code,
          codeAnalytiqueId: input.codeAnalytiqueId ?? null,
        }),
      );
    });
  }

  /** Classifies a resource onto a code analytique of the analytical plan (cahier §5.8). */
  async classifyResource(
    libraryId: string,
    resourceId: string,
    codeAnalytiqueId: string,
  ): Promise<ResourceEntity> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const existing = await em.query(
        `SELECT id FROM resource WHERE id = $1 AND library_id = $2`,
        [resourceId, libraryId],
      );
      if (existing.length === 0) {
        throw new NotFoundException(`Unknown resource "${resourceId}"`);
      }
      await this.assertCodeAnalytiqueExists(em, codeAnalytiqueId);
      await em.query(
        `UPDATE resource SET code_analytique_id = $1, updated_at = now() WHERE id = $2`,
        [codeAnalytiqueId, resourceId],
      );
      return (await em.query(`SELECT * FROM resource WHERE id = $1`, [resourceId]))[0];
    });
  }

  private async assertCodeAnalytiqueExists(em: EntityManager, codeId: string): Promise<void> {
    const rows = await em.query(`SELECT id FROM analytical_code WHERE id = $1`, [codeId]);
    if (rows.length === 0) {
      throw new NotFoundException(`Unknown code analytique "${codeId}"`);
    }
  }

  listResources(
    libraryId: string,
    query: DataGridQuery,
  ): Promise<PaginatedResult<ResourceEntity>> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) => {
      const qb = em
        .getRepository(ResourceEntity)
        .createQueryBuilder('p')
        .where('p.library_id = :libraryId', { libraryId });
      return paginate(qb, query, {
        alias: 'p',
        sortable: ['code', 'label', 'unitCost', 'createdAt'],
        searchable: ['code', 'label'],
        defaultSort: 'code',
      });
    });
  }
}
