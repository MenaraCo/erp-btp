import { Brackets, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/** Generic, reusable data-grid query contract shared by every dense list screen. */
export interface DataGridQuery {
  page?: number | string;
  pageSize?: number | string;
  sort?: string;
  dir?: string;
  search?: string;
}

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DataGridOptions {
  alias: string;
  /** Whitelisted sortable columns (entity property names). */
  sortable: string[];
  /** Columns matched (ILIKE) by the free-text search. */
  searchable: string[];
  defaultSort: string;
  maxPageSize?: number;
}

export function clampPageSize(value: unknown, max = 100, fallback = 20): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return Math.min(Math.floor(n), max);
}

export function clampPage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return Math.floor(n);
}

/** Resolves a sort column against a whitelist (prevents SQL injection / invalid columns). */
export function resolveSort(
  sort: string | undefined,
  sortable: string[],
  defaultSort: string,
): string {
  return sort && sortable.includes(sort) ? sort : defaultSort;
}

export function resolveDir(dir: string | undefined): 'ASC' | 'DESC' {
  return (dir ?? '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
}

/** Applies search + sort + pagination to a query builder and returns a paginated result. */
export async function paginate<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  query: DataGridQuery,
  opts: DataGridOptions,
): Promise<PaginatedResult<T>> {
  const page = clampPage(query.page);
  const pageSize = clampPageSize(query.pageSize, opts.maxPageSize ?? 100);

  const search = query.search?.trim();
  if (search && opts.searchable.length > 0) {
    const term = `%${search}%`;
    qb.andWhere(
      new Brackets((w) => {
        opts.searchable.forEach((col, i) => {
          const param = `dgSearch${i}`;
          w.orWhere(`${opts.alias}.${col} ILIKE :${param}`, { [param]: term });
        });
      }),
    );
  }

  const sort = resolveSort(query.sort, opts.sortable, opts.defaultSort);
  qb.orderBy(`${opts.alias}.${sort}`, resolveDir(query.dir));
  qb.skip((page - 1) * pageSize).take(pageSize);

  const [rows, total] = await qb.getManyAndCount();
  return { rows, total, page, pageSize };
}
