import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import {
  createKeyring,
  decodeCanonicalBase64,
  HMAC_SHA256_KEY_SIZE,
  KeyringError,
  parseKeyringEntries,
} from '../../src/platform/crypto/keyring';
import { keyringEntry, randomKey } from '../helpers/keys';

describe('parseKeyringEntries', () => {
  it('parses one entry per line and comma-separated entries', () => {
    const lines = parseKeyringEntries(`${keyringEntry(1)}\n${keyringEntry(2)}\r\n`);
    const commas = parseKeyringEntries(`${keyringEntry(1)}, ${keyringEntry(65535)}`);

    expect([...(lines?.keys() ?? [])]).toEqual([1, 2]);
    expect([...(commas?.keys() ?? [])]).toEqual([1, 65535]);
  });

  it('holds keys as 32-byte secret KeyObjects', () => {
    const key = parseKeyringEntries(keyringEntry(3))?.get(3);

    expect(key?.type).toBe('secret');
    expect(key?.symmetricKeySize).toBe(32);
  });

  it.each([
    ['an empty text', ''],
    ['a key of 31 bytes', keyringEntry(1, randomBytes(31))],
    ['a key of 33 bytes', keyringEntry(1, randomBytes(33))],
    ['a missing id', `:${randomBytes(32).toString('base64')}`],
    ['id 0', keyringEntry(0)],
    ['id 65536', keyringEntry(65536)],
    ['a non-numeric id', `a:${randomBytes(32).toString('base64')}`],
    ['a leading-zero id', `01:${randomBytes(32).toString('base64')}`],
    ['no separator', randomBytes(32).toString('base64')],
    ['non-canonical base64', `1:${randomBytes(32).toString('base64').replace(/=$/, '')}`],
    ['a duplicate id', `${keyringEntry(1)}\n${keyringEntry(1)}`],
  ])('refuses %s', (_label, text) => {
    expect(parseKeyringEntries(text)).toBeUndefined();
  });

  it('refuses the whole ring when one entry is bad', () => {
    expect(parseKeyringEntries(`${keyringEntry(1)}\n2:not-base64`)).toBeUndefined();
  });
});

describe('parseKeyringEntries with the HMAC-SHA256 size rule (JWT signing keys)', () => {
  it.each([32, 48, 64])('accepts a key of %i bytes', (length) => {
    const key = parseKeyringEntries(keyringEntry(1, randomBytes(length)), HMAC_SHA256_KEY_SIZE);

    expect(key?.get(1)?.symmetricKeySize).toBe(length);
  });

  it.each([16, 31, 65])('refuses a key of %i bytes', (length) => {
    expect(
      parseKeyringEntries(keyringEntry(1, randomBytes(length)), HMAC_SHA256_KEY_SIZE),
    ).toBeUndefined();
  });
});

describe('decodeCanonicalBase64', () => {
  it('accepts canonical base64 and refuses anything Buffer.from would silently repair', () => {
    const value = randomBytes(32).toString('base64');

    expect(decodeCanonicalBase64(value)?.length).toBe(32);
    expect(decodeCanonicalBase64(`${value}\n`)).toBeUndefined();
    expect(decodeCanonicalBase64(value.replace(/=$/, ''))).toBeUndefined();
    expect(decodeCanonicalBase64('')).toBeUndefined();
  });
});

describe('createKeyring', () => {
  it('requires the active key id to be in the ring', () => {
    expect(() => createKeyring(2, new Map([[1, randomKey()]]))).toThrow(KeyringError);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => createKeyring(1, new Map([[1, randomKey(16)]]))).toThrow(KeyringError);
  });

  it('applies the size rule it is given', () => {
    expect(() =>
      createKeyring(1, new Map([[1, randomKey(48)]]), HMAC_SHA256_KEY_SIZE),
    ).not.toThrow();
    expect(() => createKeyring(1, new Map([[1, randomKey(31)]]), HMAC_SHA256_KEY_SIZE)).toThrow(
      KeyringError,
    );
    expect(() => createKeyring(1, new Map([[1, randomKey(48)]]))).toThrow(KeyringError);
  });

  it('refuses an id outside 1..65535', () => {
    const keys = new Map([
      [1, randomKey()],
      [70000, randomKey()],
    ]);
    expect(() => createKeyring(1, keys)).toThrow(KeyringError);
  });

  it('copies the map, so a later change to the source does not alter the ring', () => {
    const source = new Map([[1, randomKey()]]);
    const keyring = createKeyring(1, source);
    source.delete(1);

    expect(keyring.keyFor(1)).toBeDefined();
  });

  it('exposes no map or other mutable state, and cannot be changed from outside', () => {
    const activeKey = randomKey();
    const keyring = createKeyring(1, new Map([[1, activeKey]]));
    const writable = keyring as unknown as Record<string, unknown>;

    expect(Object.isFrozen(keyring)).toBe(true);
    expect(Object.keys(keyring).sort()).toEqual(['activeKeyId', 'keyFor']);
    for (const value of Object.values(keyring)) expect(value).not.toBeInstanceOf(Map);
    // Compiled in strict mode, so a write to a frozen object throws instead of failing silently.
    expect(() => {
      writable['activeKeyId'] = 2;
    }).toThrow(TypeError);
    expect(() => {
      writable['keyFor'] = () => randomKey();
    }).toThrow(TypeError);
    expect(() => {
      writable['keys'] = new Map([[2, randomKey()]]);
    }).toThrow(TypeError);
    expect(keyring.activeKeyId).toBe(1);
    expect(keyring.keyFor(1)).toBe(activeKey);
    expect(keyring.keyFor(2)).toBeUndefined();
  });

  it('never shows key material when inspected or serialised', () => {
    const bytes = randomBytes(32);
    const keyring = createKeyring(
      1,
      parseKeyringEntries(keyringEntry(1, Buffer.from(bytes))) ?? new Map(),
    );
    const shown = `${inspect(keyring, { depth: 10, showHidden: true })}${JSON.stringify(keyring)}`;

    expect(shown).not.toContain(bytes.toString('base64'));
    expect(shown).not.toContain(bytes.toString('hex'));
  });
});
