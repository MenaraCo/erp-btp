import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  DataGridQuery,
  PaginatedResult,
  paginate,
} from '../../core/common/data-grid/data-grid';
import { LibraryEntity } from './entities/library.entity';
import { ResourceEntity, ResourceNature } from './entities/resource.entity';

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
}

@Injectable()
export class LibrariesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

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
        }),
      );
    });
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
