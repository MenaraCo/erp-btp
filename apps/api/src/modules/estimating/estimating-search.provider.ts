import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { runInTenant } from '../../core/tenancy/tenant-transaction';
import {
  SearchHit,
  SearchProvider,
} from '../../core/common/search/search-provider';

/** Makes libraries and resources searchable through universal search. */
@Injectable()
export class EstimatingSearchProvider implements SearchProvider {
  readonly type = 'estimating';

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  search(term: string, limit: number): Promise<SearchHit[]> {
    const tenantId = this.context.requireTenantId();
    const like = `%${term}%`;
    return runInTenant(this.dataSource, tenantId, async (em) => {
      const rows = await em.query(
        `SELECT id, code, name AS label, 'library' AS kind FROM library
            WHERE name ILIKE $1 OR code ILIKE $1
         UNION ALL
         SELECT id, code, label, 'resource' AS kind FROM resource
            WHERE label ILIKE $1 OR code ILIKE $1
         LIMIT $2`,
        [like, limit * 2],
      );
      return rows.map(
        (r: { id: string; code: string; label: string; kind: string }): SearchHit => ({
          type: `estimating.${r.kind}`,
          id: r.id,
          label: r.label,
          sublabel: r.code,
        }),
      );
    });
  }
}
