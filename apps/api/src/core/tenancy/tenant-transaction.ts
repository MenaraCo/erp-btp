import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext } from './tenant-context';

/**
 * Runs `work` inside a transaction whose tenant GUC is set, so PostgreSQL Row-Level
 * Security scopes every query to `tenantId`. The setting is transaction-local
 * (`set_config(..., true)`) and is reset automatically when the transaction ends.
 */
export async function runInTenant<T>(
  dataSource: DataSource,
  tenantId: string,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  if (!tenantId) {
    throw new Error('runInTenant called without a tenantId');
  }
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [
      tenantId,
    ]);
    const result = await work(queryRunner.manager);
    await queryRunner.commitTransaction();
    return result;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

/** Injectable wrapper that defaults the tenant to the current request context. */
@Injectable()
export class TenantTransactionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  run<T>(
    work: (manager: EntityManager) => Promise<T>,
    tenantId?: string,
  ): Promise<T> {
    return runInTenant(
      this.dataSource,
      tenantId ?? this.context.requireTenantId(),
      work,
    );
  }
}
