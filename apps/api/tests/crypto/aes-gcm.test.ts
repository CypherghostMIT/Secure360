import { randomBytes, randomUUID } from 'node:crypto';
import {
  type Aad,
  aadFor,
  decrypt,
  decryptFromString,
  DecryptionError,
  type DecryptionFailureReason,
  encrypt,
  encryptToString,
} from '../../src/platform/crypto/aes-gcm';
import { createKeyring } from '../../src/platform/crypto/keyring';
import { randomKey, testKeyring } from '../helpers/keys';

const HEADER = 3;
const IV = 12;
const TAG = 16;

const userId = randomUUID();
const aad = aadFor('users.totp_secret', userId);

function failureOf(fn: () => unknown): DecryptionError {
  try {
    fn();
  } catch (error) {
    if (error instanceof DecryptionError) return error;
    throw error;
  }
  throw new Error('expected a DecryptionError');
}

function expectFailure(fn: () => unknown, reason: DecryptionFailureReason): void {
  const error = failureOf(fn);
  expect(error.message).toBe('Decryption failed');
  expect(error.reason).toBe(reason);
  expect(error.cause).toBeUndefined();
}

/** Copy of `blob` with one bit flipped at `offset`. */
function flipBit(blob: Buffer, offset: number): Buffer {
  const copy = Buffer.from(blob);
  copy[offset] = (copy[offset] ?? 0) ^ 0x01;
  return copy;
}

describe('AES-256-GCM binary form', () => {
  const keyring = testKeyring([1]);
  const plaintext = randomBytes(64);

  it('round-trips a buffer', () => {
    expect(decrypt(keyring, encrypt(keyring, plaintext, aad), aad).equals(plaintext)).toBe(true);
  });

  it('round-trips an empty plaintext', () => {
    expect(decrypt(keyring, encrypt(keyring, Buffer.alloc(0), aad), aad)).toHaveLength(0);
  });

  it('writes version 1, the active key id, a 12-byte IV and a 16-byte tag', () => {
    const blob = encrypt(testKeyring([7, 300], 300), plaintext, aad);

    expect(blob.readUInt8(0)).toBe(1);
    expect(blob.readUInt16BE(1)).toBe(300);
    expect(blob).toHaveLength(HEADER + IV + plaintext.length + TAG);
  });

  it('never stores the plaintext in clear', () => {
    const text = Buffer.from('JBSWY3DPEHPK3PXP-totp-secret', 'utf8');
    expect(encrypt(keyring, text, aad).includes(text)).toBe(false);
  });

  it('uses a unique IV on every call', () => {
    const ivs = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      ivs.add(
        encrypt(keyring, plaintext, aad)
          .subarray(HEADER, HEADER + IV)
          .toString('hex'),
      );
    }
    expect(ivs.size).toBe(2000);
  });

  it('accepts a Uint8Array view into a larger buffer', () => {
    const blob = encrypt(keyring, plaintext, aad);
    const padded = Buffer.concat([Buffer.alloc(5), blob, Buffer.alloc(5)]);
    const view = new Uint8Array(padded.buffer, padded.byteOffset + 5, blob.length);

    expect(decrypt(keyring, view, aad).equals(plaintext)).toBe(true);
  });
});

describe('AES-256-GCM tampering', () => {
  const keyring = testKeyring([1, 2], 1);
  const plaintext = randomBytes(32);
  const blob = encrypt(keyring, plaintext, aad);

  it('refuses a changed version', () => {
    expectFailure(() => decrypt(keyring, flipBit(blob, 0), aad), 'unknown_version');
  });

  it('refuses a key id switched to another key of the ring', () => {
    const switched = Buffer.from(blob);
    switched.writeUInt16BE(2, 1);
    expectFailure(() => decrypt(keyring, switched, aad), 'auth_failed');
  });

  it('refuses an unknown key id', () => {
    const unknown = Buffer.from(blob);
    unknown.writeUInt16BE(99, 1);
    expectFailure(() => decrypt(keyring, unknown, aad), 'unknown_key_id');
  });

  it.each([
    ['IV', HEADER],
    ['ciphertext', HEADER + IV],
    ['tag', blob.length - 1],
  ])('refuses a modified %s', (_part, offset) => {
    expectFailure(() => decrypt(keyring, flipBit(blob, offset), aad), 'auth_failed');
  });

  it('refuses a truncated tag', () => {
    expectFailure(() => decrypt(keyring, blob.subarray(0, blob.length - 4), aad), 'auth_failed');
  });

  it('refuses a blob shorter than header + IV + tag', () => {
    expectFailure(
      () => decrypt(keyring, blob.subarray(0, HEADER + IV + TAG - 1), aad),
      'too_short',
    );
  });

  it('refuses the ciphertext of another row (AAD bound to the user id)', () => {
    expectFailure(
      () => decrypt(keyring, blob, aadFor('users.totp_secret', randomUUID())),
      'auth_failed',
    );
  });

  it('refuses the ciphertext of another field (AAD bound to the field)', () => {
    expectFailure(() => decrypt(keyring, blob, aadFor('attachments.file', userId)), 'auth_failed');
  });

  it('refuses a wrong key with the same id', () => {
    expectFailure(() => decrypt(testKeyring([1, 2], 1), blob, aad), 'auth_failed');
  });

  it('requires an AAD to encrypt and to decrypt, even when the brand is cast away', () => {
    const empty = '' as Aad;
    expect(() => encrypt(keyring, plaintext, empty)).toThrow(TypeError);
    expect(() => decrypt(keyring, blob, empty)).toThrow(TypeError);
    expect(() => aadFor('users.totp_secret', '')).toThrow(TypeError);
  });

  it('does not compile with a plain string as AAD (checked by tsc and ts-jest, never run)', () => {
    const plain = 'users.totp_secret:x';
    const compileOnly = (): void => {
      // @ts-expect-error a plain string is not an Aad
      encrypt(keyring, plaintext, plain);
      // @ts-expect-error a plain string is not an Aad
      decrypt(keyring, blob, plain);
      // @ts-expect-error a plain string is not an Aad
      encryptToString(keyring, 'x', plain);
      // @ts-expect-error a plain string is not an Aad
      decryptFromString(keyring, 'x', plain);
    };
    expect(compileOnly).toBeInstanceOf(Function);
  });
});

describe('AES-256-GCM key rotation', () => {
  it('still decrypts old data after the active key changes, and encrypts new data with the new key', () => {
    const oldKey = randomKey();
    const before = createKeyring(1, new Map([[1, oldKey]]));
    const oldBlob = encrypt(before, Buffer.from('old data'), aad);

    const after = createKeyring(
      2,
      new Map([
        [1, oldKey],
        [2, randomKey()],
      ]),
    );
    const newBlob = encrypt(after, Buffer.from('new data'), aad);

    expect(decrypt(after, oldBlob, aad).toString()).toBe('old data');
    expect(oldBlob.readUInt16BE(1)).toBe(1);
    expect(newBlob.readUInt16BE(1)).toBe(2);
    expect(decrypt(after, newBlob, aad).toString()).toBe('new data');
  });

  it('cannot decrypt once the old key is removed from the ring', () => {
    const before = testKeyring([1]);
    const blob = encrypt(before, Buffer.from('old data'), aad);
    expectFailure(() => decrypt(testKeyring([2]), blob, aad), 'unknown_key_id');
  });
});

describe('AES-256-GCM string form', () => {
  const keyring = testKeyring([1]);
  const secret = 'JBSWY3DPEHPK3PXP';

  it('round-trips a string as unpadded base64url', () => {
    const encoded = encryptToString(keyring, secret, aad);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decryptFromString(keyring, encoded, aad)).toBe(secret);
  });

  it('round-trips non-ASCII text', () => {
    const text = 'Sécurité – 安全 🔐';
    expect(decryptFromString(keyring, encryptToString(keyring, text, aad), aad)).toBe(text);
  });

  it('is the base64url of the binary form', () => {
    const encoded = encryptToString(keyring, secret, aad);
    expect(decrypt(keyring, Buffer.from(encoded, 'base64url'), aad).toString()).toBe(secret);
  });

  it.each([
    ['standard base64 characters', (s: string) => `${s}+/`],
    ['padding', (s: string) => `${s}=`],
    ['whitespace', (s: string) => ` ${s}`],
    // Unpadded base64url is never 1 character past a multiple of 4: that last character carries no full byte.
    ['a dangling character', (s: string) => s + 'A'.repeat((((1 - (s.length % 4)) % 4) + 4) % 4)],
  ])('refuses non-canonical input (%s)', (_label, mutate) => {
    const encoded = encryptToString(keyring, secret, aad);
    expectFailure(() => decryptFromString(keyring, mutate(encoded), aad), 'bad_encoding');
  });

  it('refuses a tampered string and a wrong AAD with the same generic error', () => {
    const encoded = encryptToString(keyring, secret, aad);
    const blob = Buffer.from(encoded, 'base64url');
    const tampered = flipBit(blob, HEADER + IV).toString('base64url');

    expectFailure(() => decryptFromString(keyring, tampered, aad), 'auth_failed');
    expectFailure(
      () => decryptFromString(keyring, encoded, aadFor('users.totp_secret', randomUUID())),
      'auth_failed',
    );
  });

  it('refuses an empty string as too short', () => {
    expectFailure(() => decryptFromString(keyring, '', aad), 'too_short');
  });
});
