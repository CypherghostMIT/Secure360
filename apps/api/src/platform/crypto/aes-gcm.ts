import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Keyring } from './keyring';

/*
 * Ciphertext format v1 (BNF04, L2 §7.6 / §8.6):
 *
 *   offset  size  field
 *   0       1     version (0x01)
 *   1       2     key id, big-endian uint16
 *   3       12    IV
 *   15      n     ciphertext
 *   15 + n  16    GCM authentication tag
 *
 * The GCM additional data is the 3-byte header followed by the caller's context string, so the version and key id
 * are authenticated and a ciphertext moved to another row or column fails to decrypt. The header has a fixed
 * length, so header + context cannot be ambiguous.
 */
const ALGORITHM = 'aes-256-gcm';
const FORMAT_VERSION = 0x01;
const HEADER_BYTES = 3;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_BLOB_BYTES = HEADER_BYTES + IV_BYTES + TAG_BYTES;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;

export type DecryptionFailureReason =
  'too_short' | 'bad_encoding' | 'unknown_version' | 'unknown_key_id' | 'auth_failed';

/**
 * The only error a decryption failure produces. The message never says which part failed; `reason` is for internal
 * logs only (the error handler maps this error to INTERNAL_ERROR with the generic message).
 */
export class DecryptionError extends Error {
  override readonly name = 'DecryptionError';

  constructor(readonly reason: DecryptionFailureReason) {
    super('Decryption failed');
  }
}

/** Encrypted fields and the row they belong to. Add a field here before encrypting a new kind of data. */
export type EncryptedField = 'users.totp_secret' | 'attachments.file';

declare const aadBrand: unique symbol;

/**
 * Additional data binding a ciphertext to one field of one row, e.g. "users.totp_secret:<user id>". Branded: only
 * aadFor() produces one, so a caller cannot pass an ad-hoc string that binds to nothing.
 */
export type Aad = string & { readonly [aadBrand]: true };

export function aadFor(field: EncryptedField, rowId: string): Aad {
  if (rowId === '') throw new TypeError('aadFor needs a row id');
  return `${field}:${rowId}` as Aad;
}

// Still checked at run time: a cast or a JavaScript caller can get past the brand.
function requireAad(aad: Aad): Buffer {
  if (aad === '') throw new TypeError('Encryption context (AAD) is required');
  return Buffer.from(aad, 'utf8');
}

function header(keyId: number): Buffer {
  const bytes = Buffer.alloc(HEADER_BYTES);
  bytes.writeUInt8(FORMAT_VERSION, 0);
  bytes.writeUInt16BE(keyId, 1);
  return bytes;
}

/** Encrypts with the active key. Binary form, for attachments and bytea columns (users.totp_secret_enc). */
export function encrypt(keyring: Keyring, plaintext: Uint8Array, aad: Aad): Buffer {
  const context = requireAad(aad);
  const key = keyring.keyFor(keyring.activeKeyId);
  if (key === undefined) throw new TypeError('The active key is missing from the keyring');
  const head = header(keyring.activeKeyId);
  // A random 96-bit IV per encryption: the collision risk stays negligible well below 2^32 encryptions per key
  // (NIST SP 800-38D), a volume this platform never approaches, and key rotation resets the count.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.concat([head, context]));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([head, iv, body, cipher.getAuthTag()]);
}

function openBlob(keyring: Keyring, blob: Uint8Array, context: Buffer): Buffer {
  const bytes = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (bytes.length < MIN_BLOB_BYTES) throw new DecryptionError('too_short');
  if (bytes.readUInt8(0) !== FORMAT_VERSION) throw new DecryptionError('unknown_version');
  const key = keyring.keyFor(bytes.readUInt16BE(1));
  if (key === undefined) throw new DecryptionError('unknown_key_id');
  const iv = bytes.subarray(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
  const tagStart = bytes.length - TAG_BYTES;
  try {
    // authTagLength pins the tag size: a truncated tag is refused instead of verified on fewer bits.
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.concat([bytes.subarray(0, HEADER_BYTES), context]));
    decipher.setAuthTag(bytes.subarray(tagStart));
    const body = bytes.subarray(HEADER_BYTES + IV_BYTES, tagStart);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // No cause: the library message must not reach logs or callers.
    throw new DecryptionError('auth_failed');
  }
}

/** Decrypts a binary ciphertext. Throws DecryptionError, and nothing else, for any bad input. */
export function decrypt(keyring: Keyring, blob: Uint8Array, aad: Aad): Buffer {
  return openBlob(keyring, blob, requireAad(aad));
}

/** String form for text or JSON fields: unpadded base64url of the binary form. */
export function encryptToString(keyring: Keyring, plaintext: string, aad: Aad): string {
  return encrypt(keyring, Buffer.from(plaintext, 'utf8'), aad).toString('base64url');
}

/** Only canonical base64url is accepted: Buffer.from() would silently skip unexpected characters. */
export function decryptFromString(keyring: Keyring, encoded: string, aad: Aad): string {
  const context = requireAad(aad);
  const blob = BASE64URL_PATTERN.test(encoded) ? Buffer.from(encoded, 'base64url') : undefined;
  if (blob === undefined || blob.toString('base64url') !== encoded) {
    throw new DecryptionError('bad_encoding');
  }
  return openBlob(keyring, blob, context).toString('utf8');
}
