import { createHmac, randomBytes } from 'node:crypto';

/**
 * TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30s step) — dependency-free MFA.
 * Secrets are base32 (RFC 4648) so they work with standard authenticator apps.
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totp(secret: string, timeMs: number = Date.now()): string {
  const counter = Math.floor(timeMs / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secret), counter);
}

/** Verifies a code within ±`window` steps to tolerate clock drift. */
export function verifyTotp(
  secret: string,
  code: string,
  timeMs: number = Date.now(),
  window = 1,
): boolean {
  const key = base32Decode(secret);
  const counter = Math.floor(timeMs / 1000 / STEP_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    if (hotp(key, counter + offset) === code) {
      return true;
    }
  }
  return false;
}

function hotp(key: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  // 32-bit halves: high then low (counter < 2^53 in practice).
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', key).update(counterBuf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      continue;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
