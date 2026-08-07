import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, DeepPartial, EntityTarget, ObjectLiteral } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import { PartyExistante, trouverDoublon } from './party-doublon';
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

  /**
   * Crée un fournisseur. `aValider` vient du contrôleur : une fiche PROPOSÉE (par qui n'a pas la
   * main sur le référentiel) entre « à valider ». Elle est utilisable tout de suite — le chantier
   * n'attend pas — mais signalée jusqu'à sa régularisation.
   */
  createSupplier(input: PartyInput, aValider = false): Promise<SupplierEntity> {
    return this.create(SupplierEntity, input, aValider);
  }

  /** File d'attente : les fiches proposées, de la plus ancienne à la plus récente. */
  listSuppliersAValider(): Promise<SupplierEntity[]> {
    const tenantId = this.context.requireTenantId();
    return runInTenant(this.dataSource, tenantId, (em) =>
      em.getRepository(SupplierEntity).find({
        where: { statut: 'a_valider' } as never,
        order: { proposedAt: 'ASC' } as never,
      }),
    );
  }

  /**
   * Valide une fiche proposée. Qui en a le droit ne se décide pas ici mais par la permission
   * `directory.validate`, que chaque société pose sur le rôle de son choix.
   */
  validateSupplier(id: string): Promise<SupplierEntity> {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId() ?? null;
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const repo = em.getRepository(SupplierEntity);
      const existing = await repo.findOne({ where: { id } as never });
      if (!existing) {
        throw new NotFoundException(`Fournisseur introuvable (${id}).`);
      }
      if (existing.statut === 'valide') {
        throw new ConflictException('Cette fiche est déjà validée.');
      }
      await em.query(
        `UPDATE supplier SET statut = 'valide', validated_by = $2, validated_at = now(),
                             updated_at = now()
          WHERE id = $1`,
        [id, userId],
      );
      return repo.findOneOrFail({ where: { id } as never });
    });
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
    aValider = false,
  ): Promise<T> {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.getUserId() ?? null;
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const repo = em.getRepository(entity);

      // Barrage aux doublons, DANS la transaction : on compare au référentiel vivant plutôt qu'à
      // une photo prise avant. Les fiches supprimées ne comptent pas — un code libéré se réutilise.
      const existantes = (await repo.find({
        where: { deletedAt: null } as never,
        select: ['id', 'code', 'name', 'vatNumber'] as never,
      })) as unknown as PartyExistante[];
      const doublon = trouverDoublon(input, existantes);
      if (doublon) {
        throw new ConflictException(doublon.message);
      }

      const extra = aValider
        ? { statut: 'a_valider', proposedBy: userId, proposedAt: new Date() }
        : {};
      return repo.save({
        ...input,
        ...extra,
        tenantId,
      } as unknown as DeepPartial<T>) as Promise<T>;
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
