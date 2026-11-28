import { createSecretKey, type KeyObject, randomBytes } from 'node:crypto';
import {
  createKeyring,
  HMAC_SHA256_KEY_SIZE,
  type Keyring,
} from '../../src/platform/crypto/keyring';

// Keys are generated per run: no key material lives in the repository (gitleaks, AGENTS.md rule 6).
export const randomKey = (bytes = 32): KeyObject => createSecretKey(randomBytes(bytes));

/** Keyring with fresh random keys for the given ids; the first id is active unless `activeKeyId` says otherwise. */
export function testKeyring(ids: readonly number[] = [1], activeKeyId = ids[0] ?? 1): Keyring {
  return createKeyring(activeKeyId, new Map(ids.map((id) => [id, randomKey()])));
}

/** JWT signing keyring (HMAC-SHA256 size rule) built from the given keys. */
export function jwtKeyring(keys: ReadonlyMap<number, KeyObject>, activeKeyId: number): Keyring {
  return createKeyring(activeKeyId, keys, HMAC_SHA256_KEY_SIZE);
}

/** Text form of a keyring entry, as written in the data_encryption_keys secret file. */
export const keyringEntry = (id: number, bytes = randomBytes(32)): string =>
  `${id}:${bytes.toString('base64')}`;
