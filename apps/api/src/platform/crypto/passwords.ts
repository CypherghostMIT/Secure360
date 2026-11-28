import { randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';

// L2 §8.2. bcryptjs: same $2b$ algorithm as native bcrypt, without install scripts (task 5, BUILD_CHECKLIST task 12).
export const BCRYPT_COST = 12;
// bcrypt silently ignores everything after 72 bytes, so two passwords sharing those bytes would match.
export const BCRYPT_MAX_BYTES = 72;

export class PasswordTooLongError extends Error {
  override readonly name = 'PasswordTooLongError';

  constructor() {
    super(`Password exceeds ${BCRYPT_MAX_BYTES} UTF-8 bytes`);
  }
}

const isTooLong = (plain: string): boolean => Buffer.byteLength(plain, 'utf8') > BCRYPT_MAX_BYTES;

// A hash of a random value, never a literal: it only has to cost the same as a real comparison.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hash(randomBytes(32).toString('base64url'), BCRYPT_COST);
  return dummyHash;
}

/** Computes the dummy hash at boot so the first unknown-e-mail login costs no more than the others. */
export async function warmUpPasswordHashing(): Promise<void> {
  await getDummyHash();
}

/** Defence in depth behind PasswordSchema, which already refuses more than 72 bytes. */
export async function hashPassword(plain: string): Promise<string> {
  if (isTooLong(plain)) throw new PasswordTooLongError();
  return hash(plain, BCRYPT_COST);
}

/**
 * `storedHash` is null when the e-mail is unknown: the comparison still runs, against the dummy hash, so response
 * time does not reveal which accounts exist (L2 §8.2). An over-long password is refused the same way, so bcrypt's
 * truncation can never let a longer password match.
 */
export async function verifyPassword(plain: string, storedHash: string | null): Promise<boolean> {
  if (storedHash === null || isTooLong(plain)) {
    await compare(plain, await getDummyHash());
    return false;
  }
  return compare(plain, storedHash);
}
