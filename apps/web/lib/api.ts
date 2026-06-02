export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Bearer access token (authenticated calls). */
  token?: string | null;
  /** Tenant slug, used for the unauthenticated login call (dev). */
  tenantSlug?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  if (options.tenantSlug) {
    headers['X-Tenant-Slug'] = options.tenantSlug;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.message ?? res.statusText;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : message);
  }
  return data as T;
}
