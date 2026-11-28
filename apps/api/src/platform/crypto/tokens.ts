import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const OPAQUE_TOKEN_BYTES = 32;

/** Refresh, reset and set-password tokens: 256 random bits, base64url (43 characters, L2 §8.2). */
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
}

/**
 * SHA-256 of a token, as stored in refresh_tokens.token_hash and password_reset_tokens.token_hash (bytea, Prisma
 * Bytes). A plain hash is enough: the tokens carry 256 random bits, so there is nothing to brute-force.
 */
export function hashToken(token: string): Buffer<ArrayBuffer> {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Constant-time comparison. Inputs of different lengths return false straight away, which reveals only the length;
 * callers compare fixed-length values (hashes, codes).
 */
export function safeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const left = typeof a === 'string' ? Buffer.from(a, 'utf8') : a;
  const right = typeof b === 'string' ? Buffer.from(b, 'utf8') : b;
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Random (v4) UUID for primary keys and file names. */
export function newId(): string {
  return randomUUID();
}
