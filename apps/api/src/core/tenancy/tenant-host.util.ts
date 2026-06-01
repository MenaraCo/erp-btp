/**
 * Derives a tenant slug from an HTTP Host header, relative to the configured base domain.
 *
 *   acme.localhost        (base "localhost") -> "acme"
 *   acme.eu.localhost     (base "localhost") -> "acme"   (left-most label)
 *   localhost             (base "localhost") -> null      (bare base domain)
 *   127.0.0.1 / other.com (base "localhost") -> null      (does not match base)
 *
 * Returns null when no tenant sub-domain is present (caller then falls back to the header).
 */
export function extractTenantSlugFromHost(
  host: string | undefined,
  baseDomain: string,
): string | null {
  if (!host) {
    return null;
  }
  const hostname = host.split(':')[0].toLowerCase().trim();
  const base = baseDomain.toLowerCase().trim();

  if (!hostname || hostname === base) {
    return null;
  }
  const suffix = `.${base}`;
  if (!hostname.endsWith(suffix)) {
    return null;
  }
  const prefix = hostname.slice(0, -suffix.length);
  const firstLabel = prefix.split('.')[0];
  return firstLabel || null;
}
