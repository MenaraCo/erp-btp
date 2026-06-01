import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal HS256 JWT using node:crypto — no external dependency. Enough for first-party auth;
 * an OIDC provider can replace this later without touching the rest of the stack.
 */
export interface JwtPayload {
  /** subject = user id */
  sub: string;
  /** tenant id */
  tid: string;
  email?: string;
  iat?: number;
  exp?: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlJson(obj: unknown): string {
  return base64url(JSON.stringify(obj));
}

function sign(data: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(data).digest());
}

export function signJwt(
  payload: JwtPayload,
  secret: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = base64urlJson(full);
  const signature = sign(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

/** Returns the payload if the token is valid and unexpired, otherwise null (never throws). */
export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64').toString('utf8'),
    ) as JwtPayload;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
