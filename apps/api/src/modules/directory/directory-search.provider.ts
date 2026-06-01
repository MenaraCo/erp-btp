import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  SearchHit,
  SearchProvider,
} from '../../core/common/search/search-provider';

/** Makes clients and suppliers searchable through universal search. */
@Injectable()
export class DirectorySearchProvider implements SearchProvider {
  readonly type = 'directory';

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  search(term: string, limit: number): Promise<SearchHit[]> {
    const tenantId = this.context.requireTenantId();
    const like = `%${term}%`;
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT id, code, name, 'client' AS kind FROM client
            WHERE name ILIKE $1 OR code ILIKE $1
         UNION ALL
         SELECT id, code, name, 'supplier' AS kind FROM supplier
            WHERE name ILIKE $1 OR code ILIKE $1
         LIMIT $2`,
        [like, limit * 2],
      );
      return rows.map(
        (r: { id: string; code: string; name: string; kind: string }): SearchHit => ({
          type: `directory.${r.kind}`,
          id: r.id,
          label: r.name,
          sublabel: r.code,
        }),
      );
    });
  }
}
