import { createHash } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client';
import { generateOpaqueToken, hashToken, newId, safeEqual } from '../../src/platform/crypto/tokens';
import { OpaqueTokenSchema } from '@secure360/shared';

describe('generateOpaqueToken', () => {
  it('returns 43 base64url characters (256 bits) accepted by OpaqueTokenSchema', () => {
    const token = generateOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(OpaqueTokenSchema.parse(token)).toBe(token);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 5000 }, generateOpaqueToken));
    expect(tokens.size).toBe(5000);
  });
});

describe('hashToken', () => {
  it('returns the 32-byte SHA-256 digest of the token', () => {
    const token = generateOpaqueToken();
    const expected = createHash('sha256').update(token, 'utf8').digest();

    expect(hashToken(token).equals(expected)).toBe(true);
    expect(hashToken(token)).toHaveLength(32);
  });

  it('fits the bytea token_hash columns (Prisma Bytes)', () => {
    // Compile-time check: fails typecheck if the return type stops matching the Prisma field types.
    const refresh: Prisma.RefreshTokenCreateManyInput['tokenHash'] = hashToken('a');
    const reset: Prisma.PasswordResetTokenCreateManyInput['tokenHash'] = hashToken('b');

    expect(refresh).toBeInstanceOf(Uint8Array);
    expect(reset).toBeInstanceOf(Uint8Array);
  });

  it('differs for different tokens', () => {
    expect(hashToken('a').equals(hashToken('b'))).toBe(false);
  });
});

describe('safeEqual', () => {
  it('compares strings and bytes', () => {
    const hash = hashToken('token');

    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual(hash, hashToken('token'))).toBe(true);
    expect(safeEqual(hash, hashToken('other'))).toBe(false);
  });

  it('returns false for different lengths instead of throwing', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(Buffer.alloc(32), Buffer.alloc(31))).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('newId', () => {
  it('returns unique v4 UUIDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));

    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
