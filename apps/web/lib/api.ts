export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? '/api-proxy';

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

/** Uploads a file via multipart/form-data (field "file"). Le navigateur pose le Content-Type. */
export async function apiUpload<T = unknown>(
  path: string,
  file: File,
  token: string | null,
): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.message ?? res.statusText;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : message);
  }
  return data as T;
}

/** Fetches a binary resource (e.g. a PDF) with the bearer token and returns a blob URL. */
/**
 * Télécharge un fichier de l'API et le remet à l'utilisateur.
 *
 * On passe par un <a download> synthétique plutôt que window.open : l'appel intervient APRÈS
 * un await, donc hors du geste utilisateur, et les navigateurs bloquent alors les popups.
 */
export async function apiDownload(path: string, token: string | null, filename: string): Promise<void> {
  const url = await apiFetchBlobUrl(path, token);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Laisser le temps au navigateur d'amorcer le téléchargement avant de libérer l'URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function apiFetchBlobUrl(path: string, token: string | null): Promise<string> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText);
  }
  return URL.createObjectURL(await res.blob());
}
