import * as bcrypt from 'bcryptjs';
import type * as Bcrypt from 'bcryptjs';
import {
  BCRYPT_COST,
  hashPassword,
  PasswordTooLongError,
  verifyPassword,
  warmUpPasswordHashing,
} from '../../src/platform/crypto/passwords';

// The real bcryptjs, wrapped so the tests can count comparisons.
jest.mock('bcryptjs', () => {
  const actual = jest.requireActual<typeof Bcrypt>('bcryptjs');
  return {
    ...actual,
    compare: jest.fn<Promise<boolean>, [string, string]>((plain, hash) =>
      actual.compare(plain, hash),
    ),
    hash: jest.fn<Promise<string>, [string, number]>((plain, cost) => actual.hash(plain, cost)),
  };
});
const compareMock = jest.mocked(bcrypt.compare);
const hashMock = jest.mocked(bcrypt.hash);

// Cost 12 is slow by design; a few seconds per test is expected.
jest.setTimeout(60_000);

// Built at runtime: no password literal in the repository.
const password = `Pw${Date.now().toString(36)}aZ9`;

let storedHash: string;
beforeAll(async () => {
  storedHash = await hashPassword(password);
});
beforeEach(() => {
  compareMock.mockClear();
  hashMock.mockClear();
});

describe('hashPassword', () => {
  it('produces a $2b$ hash at cost 12', () => {
    expect(BCRYPT_COST).toBe(12);
    expect(storedHash).toMatch(/^\$2b\$12\$[./A-Za-z0-9]{53}$/);
  });

  it('accepts exactly 72 UTF-8 bytes', async () => {
    await expect(hashPassword('é'.repeat(36))).resolves.toMatch(/^\$2b\$12\$/);
  });

  it('refuses more than 72 UTF-8 bytes without hashing or echoing the value', async () => {
    const tooLong = 'é'.repeat(36) + 'x'; // 73 bytes, 37 characters
    const error = await hashPassword(tooLong).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PasswordTooLongError);
    expect((error as Error).message).not.toContain('é');
    expect(hashMock).not.toHaveBeenCalled();
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and refuses a wrong one', async () => {
    await expect(verifyPassword(password, storedHash)).resolves.toBe(true);
    await expect(verifyPassword(`${password}x`, storedHash)).resolves.toBe(false);
  });

  it('returns false for an unknown e-mail (null hash) after exactly one bcrypt comparison at cost 12', async () => {
    await warmUpPasswordHashing();
    hashMock.mockClear();

    await expect(verifyPassword(password, null)).resolves.toBe(false);

    expect(compareMock).toHaveBeenCalledTimes(1);
    const [, dummy] = compareMock.mock.calls[0] ?? [];
    expect(dummy).toMatch(/^\$2b\$12\$/);
    // The dummy hash is computed once, not per call.
    expect(hashMock).not.toHaveBeenCalled();
  });

  it('uses the same dummy hash on every unknown-e-mail call', async () => {
    await verifyPassword('first', null);
    await verifyPassword('second', null);

    const dummies = compareMock.mock.calls.map(([, hash]) => hash);
    expect(new Set(dummies).size).toBe(1);
  });

  it('refuses an over-long password after one dummy comparison, even when its first 72 bytes match', async () => {
    const base = 'A1b'.repeat(24); // 72 bytes
    const hash = await hashPassword(base);
    compareMock.mockClear();

    await expect(verifyPassword(`${base}extra`, hash)).resolves.toBe(false);
    expect(compareMock).toHaveBeenCalledTimes(1);
    expect(compareMock.mock.calls[0]?.[1]).not.toBe(hash);
  });
});
