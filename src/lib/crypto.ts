/**
 * Cryptography helpers for enrollment tokens and agent credentials.
 *
 * Uses only the runtime's WebCrypto primitives (Workers or Node). Tokens and
 * credentials are random values that are fingerprintable server-side only by
 * their HMAC-SHA256 digest under a per-purpose secret; the plaintext is never
 * stored. These functions intentionally return single-use values / digests and
 * must never be logged.
 */

const TEXT_ENCODER = new TextEncoder();
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64URL_ALPHABET[a >> 2];
    out += BASE64URL_ALPHABET[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? BASE64URL_ALPHABET[((b & 15) << 2) | (c >> 6)] : '';
    out += i + 2 < bytes.length ? BASE64URL_ALPHABET[c & 63] : '';
  }
  return out;
}

/**
 * Generates a cryptographically secure random value as a base64url string.
 * Default 32 bytes -> 256 bits of entropy. Used for enrollment tokens and
 * agent credentials.
 */
export function generateSecret(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bytesToBase64Url(buf);
}

async function hmac(keyBytes: Uint8Array, data: Uint8Array): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', keyBytes.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, data);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/**
 * HMAC-SHA256 digest of a secret value under a purpose-specific key.
 * The returned digest is what gets stored; the plaintext value is discarded.
 * The `purpose` salt keeps digests from different endpoints non-transferable.
 */
export async function hashSecret(value: string, secret: string, purpose: string): Promise<string> {
  const keyBytes = TEXT_ENCODER.encode(`v1:${secret}`);
  const data = TEXT_ENCODER.encode(`v1:${purpose}:${value}`);
  const digest = await hmac(keyBytes, data);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Constant-time string comparison. Both inputs must be equal length; callers
 * hash the same inputs with the same function so this holds.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Base64url-encoded random agent identifier (prefixed for readability). */
export function generateAgentId(): string {
  return `ag_${generateSecret(16)}`;
}
