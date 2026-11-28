import { createSecretKey, type KeyObject } from 'node:crypto';

export const AES_256_KEY_BYTES = 32;

/** Accepted key lengths in bytes, inclusive. Each ring has its own rule: one purpose, one key size. */
export interface KeySize {
  readonly min: number;
  readonly max: number;
}

export const AES_256_KEY_SIZE: KeySize = { min: AES_256_KEY_BYTES, max: AES_256_KEY_BYTES };
// HMAC-SHA256 (JWT HS256): at least the hash output (RFC 2104 §3, RFC 7518 §3.2); keys longer than the 64-byte block
// are hashed down first, so they add nothing but would hide a wrong file.
export const HMAC_SHA256_KEY_SIZE: KeySize = { min: 32, max: 64 };

const fitsSize = (length: number, size: KeySize): boolean =>
  length >= size.min && length <= size.max;
// The key id is stored as a big-endian uint16 in every ciphertext header (aes-gcm.ts).
export const MIN_KEY_ID = 1;
export const MAX_KEY_ID = 0xffff;

/**
 * Data-encryption keys and JWT signing keys (L2 §8.2, §8.6): several keys, one active for new data or tokens, the
 * others kept so old ciphertexts still decrypt and tokens signed before a rotation still verify. Keys are KeyObjects so util.inspect, JSON.stringify and the logger never print key material.
 * The keys live in a closure: no caller can add, replace or remove one after the ring is built.
 */
export interface Keyring {
  readonly activeKeyId: number;
  /** The key for an id, or undefined when the ring does not hold it. */
  keyFor(id: number): KeyObject | undefined;
}

export class KeyringError extends Error {
  override readonly name = 'KeyringError';
}

const KEY_ID_PATTERN = /^[1-9][0-9]{0,4}$/;

/** Decodes canonical base64 only: Buffer.from() silently skips invalid characters and missing padding. */
export function decodeCanonicalBase64(value: string): Buffer | undefined {
  const decoded = Buffer.from(value, 'base64');
  return decoded.length > 0 && decoded.toString('base64') === value ? decoded : undefined;
}

/** Copies the bytes into a KeyObject and wipes the temporary buffer. */
export function toSecretKey(bytes: Buffer): KeyObject {
  const key = createSecretKey(bytes);
  bytes.fill(0);
  return key;
}

/** `<id>` of a keyring entry, also DATA_ENCRYPTION_ACTIVE_KEY_ID: decimal digits only, no sign, space or leading zero. */
export function parseKeyId(text: string): number | undefined {
  if (!KEY_ID_PATTERN.test(text)) return undefined;
  const id = Number(text);
  return id >= MIN_KEY_ID && id <= MAX_KEY_ID ? id : undefined;
}

function parseEntry(entry: string, size: KeySize): [number, KeyObject] | undefined {
  const separator = entry.indexOf(':');
  if (separator === -1) return undefined;
  const id = parseKeyId(entry.slice(0, separator).trim());
  const bytes = decodeCanonicalBase64(entry.slice(separator + 1).trim());
  if (id === undefined || bytes === undefined) return undefined;
  if (!fitsSize(bytes.length, size)) {
    bytes.fill(0);
    return undefined;
  }
  return [id, toSecretKey(bytes)];
}

/**
 * Parses `<id>:<base64 key>` entries, one per line (Docker secret file) or comma-separated (.env). The key length
 * must fit `size` (default: exactly 32 bytes, AES-256). Returns undefined on any malformed entry, duplicate id or
 * empty ring, never a partial ring.
 */
export function parseKeyringEntries(
  text: string,
  size: KeySize = AES_256_KEY_SIZE,
): ReadonlyMap<number, KeyObject> | undefined {
  const entries = text
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const keys = new Map<number, KeyObject>();
  for (const entry of entries) {
    const parsed = parseEntry(entry, size);
    if (parsed === undefined || keys.has(parsed[0])) return undefined;
    keys.set(parsed[0], parsed[1]);
  }
  return keys.size > 0 ? keys : undefined;
}

/** Validates the ring again (it may be built outside the config loader, e.g. by tests or a worker). */
export function createKeyring(
  activeKeyId: number,
  keys: ReadonlyMap<number, KeyObject>,
  size: KeySize = AES_256_KEY_SIZE,
): Keyring {
  for (const [id, key] of keys) {
    const isValidId = Number.isInteger(id) && id >= MIN_KEY_ID && id <= MAX_KEY_ID;
    const isValidKey = key.type === 'secret' && fitsSize(key.symmetricKeySize ?? 0, size);
    if (!isValidId || !isValidKey) {
      throw new KeyringError(`Every key must be a secret key of ${size.min} to ${size.max} bytes`);
    }
  }
  if (!keys.has(activeKeyId)) throw new KeyringError('The active key id is not in the keyring');
  const ring = new Map(keys);
  return Object.freeze({ activeKeyId, keyFor: (id: number) => ring.get(id) });
}
