/** A single universal-search result. */
export interface SearchHit {
  type: string;
  id: string;
  label: string;
  sublabel?: string;
}

/** Implemented by each domain module that wants to be searchable. */
export interface SearchProvider {
  readonly type: string;
  search(term: string, limit: number): Promise<SearchHit[]>;
}

/** DI token for the array of registered search providers. */
export const SEARCH_PROVIDERS = Symbol('SEARCH_PROVIDERS');
