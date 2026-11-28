import { createSecretKey, type KeyObject } from 'node:crypto';

export const AES_256_KEY_BYTES = 32;
// The key id is stored as a big-endian uint16 in every ciphertext header (aes-gcm.ts).
export const MIN_KEY_ID = 1;
export const MAX_KEY_ID = 0xffff;

/**
 * Data-encryption keys (L2 §8.6): several keys, one active for new data, the others kept so old ciphertexts still
 * decrypt. Keys are KeyObjects so util.inspect, JSON.stringify and the logger never print key material.
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

function parseEntry(entry: string): [number, KeyObject] | undefined {
  const separator = entry.indexOf(':');
  if (separator === -1) return undefined;
  const id = parseKeyId(entry.slice(0, separator).trim());
  const bytes = decodeCanonicalBase64(entry.slice(separator + 1).trim());
  if (id === undefined || bytes === undefined) return undefined;
  if (bytes.length !== AES_256_KEY_BYTES) {
    bytes.fill(0);
    return undefined;
  }
  return [id, toSecretKey(bytes)];
}

/**
 * Parses `<id>:<base64 of 32 bytes>` entries, one per line (Docker secret file) or comma-separated (.env).
 * Returns undefined on any malformed entry, duplicate id or empty ring, never a partial ring.
 */
export function parseKeyringEntries(text: string): ReadonlyMap<number, KeyObject> | undefined {
  const entries = text
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const keys = new Map<number, KeyObject>();
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    if (parsed === undefined || keys.has(parsed[0])) return undefined;
    keys.set(parsed[0], parsed[1]);
  }
  return keys.size > 0 ? keys : undefined;
}

/** Validates the ring again (it may be built outside the config loader, e.g. by tests or a worker). */
export function createKeyring(activeKeyId: number, keys: ReadonlyMap<number, KeyObject>): Keyring {
  for (const [id, key] of keys) {
    const isValidId = Number.isInteger(id) && id >= MIN_KEY_ID && id <= MAX_KEY_ID;
    if (!isValidId || key.type !== 'secret' || key.symmetricKeySize !== AES_256_KEY_BYTES) {
      throw new KeyringError('Every data-encryption key must be a 32-byte secret key');
    }
  }
  if (!keys.has(activeKeyId)) throw new KeyringError('The active key id is not in the keyring');
  const ring = new Map(keys);
  return Object.freeze({ activeKeyId, keyFor: (id: number) => ring.get(id) });
}
