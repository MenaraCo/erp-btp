import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, DeepPartial, EntityTarget, ObjectLiteral } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  DataGridQuery,
  PaginatedResult,
  paginate,
} from '../../core/common/data-grid/data-grid';
import { ClientEntity } from './entities/client.entity';
import { SupplierEntity } from './entities/supplier.entity';

export interface PartyInput {
  code: string;
  name: string;
  vatNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: Record<string, unknown> | null;
}

const PARTY_GRID = {
  sortable: ['code', 'name', 'createdAt'],
  searchable: ['code', 'name', 'email', 'vatNumber'],
  defaultSort: 'code',
};

@Injectable()
export class DirectoryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  createClient(input: PartyInput): Promise<ClientEntity> {
    return this.create(ClientEntity, input);
  }

  listClients(query: DataGridQuery): Promise<PaginatedResult<ClientEntity>> {
    return this.list(ClientEntity, query);
  }

  createSupplier(input: PartyInput): Promise<SupplierEntity> {
    return this.create(SupplierEntity, input);
  }

  listSuppliers(query: DataGridQuery): Promise<PaginatedResult<SupplierEntity>> {
    return this.list(SupplierEntity, query);
  }

  updateClient(id: string, input: PartyInput): Promise<ClientEntity> {
    return this.update(ClientEntity, id, input);
  }

  updateSupplier(id: string, input: PartyInput): Promise<SupplierEntity> {
    return this.update(SupplierEntity, id, input);
  }

  /** Soft delete (the project never hard-deletes user data — sets deleted_at). */
  deleteClient(id: string): Promise<void> {
    return this.softDelete(ClientEntity, id);
  }

  deleteSupplier(id: string): Promise<void> {
    return this.softDelete(SupplierEntity, id);
  }

  private update<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    id: string,
    input: PartyInput,
  ): Promise<T> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const repo = em.getRepository(entity);
      const existing = await repo.findOne({ where: { id } as never });
      if (!existing) {
        throw new NotFoundException(`Unknown record "${id}"`);
      }
      await repo.update(id, {
        code: input.code,
        name: input.name,
        vatNumber: input.vatNumber ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
      } as unknown as DeepPartial<T> as never);
      return repo.findOneOrFail({ where: { id } as never });
    });
  }

  private softDelete<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    id: string,
  ): Promise<void> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const res = await em.getRepository(entity).softDelete(id);
      if (!res.affected) {
        throw new NotFoundException(`Unknown record "${id}"`);
      }
    });
  }

  private create<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    input: PartyInput,
  ): Promise<T> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const repo = em.getRepository(entity);
      return repo.save({ ...input, tenantId } as unknown as DeepPartial<T>) as Promise<T>;
    });
  }

  private list<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    query: DataGridQuery,
  ): Promise<PaginatedResult<T>> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const qb = em.getRepository(entity).createQueryBuilder('p');
      return paginate(qb, query, { alias: 'p', ...PARTY_GRID });
    });
  }
}
