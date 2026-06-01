import { Inject, Injectable } from '@nestjs/common';
import {
  SearchHit,
  SearchProvider,
  SEARCH_PROVIDERS,
} from './search-provider';

/**
 * Aggregates results from every registered SearchProvider. Modules register providers via the
 * SEARCH_PROVIDERS token, so universal search grows as new bounded contexts come online.
 */
@Injectable()
export class UniversalSearchService {
  constructor(
    @Inject(SEARCH_PROVIDERS) private readonly providers: SearchProvider[],
  ) {}

  async search(term: string, limitPerType = 5): Promise<SearchHit[]> {
    if (!term || !term.trim()) {
      return [];
    }
    const batches = await Promise.all(
      this.providers.map((p) => p.search(term.trim(), limitPerType)),
    );
    return batches.flat();
  }
}
