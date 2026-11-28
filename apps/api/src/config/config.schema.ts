import type { KeyObject } from 'node:crypto';
import { z } from 'zod';
import {
  decodeCanonicalBase64,
  HMAC_SHA256_KEY_SIZE,
  type Keyring,
  parseKeyId,
  parseKeyringEntries,
} from '../platform/crypto/keyring';

// Keys that may come from a Docker secret file (/run/secrets/<lowercase key>, L2 §8.6). Every other key is
// plain configuration and is read from the environment only.
export const SECRET_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SIGNING_KEYS',
  'DATA_ENCRYPTION_KEYS',
  'RATE_LIMIT_HMAC_KEY',
] as const;

// HMAC-SHA256 keys shorter than the hash output weaken it (RFC 2104 §3).
export const MIN_HMAC_KEY_BYTES = 32;

function isHmacKeyText(value: string): boolean {
  const bytes = decodeCanonicalBase64(value);
  const isLongEnough = bytes !== undefined && bytes.length >= MIN_HMAC_KEY_BYTES;
  bytes?.fill(0);
  return isLongEnough;
}

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // Number of reverse proxies in front of the API (Nginx = 1). 0 trusts no X-Forwarded-* header, so a
    // directly exposed API cannot be fooled about the client IP.
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    // No schema default: the default depends on NODE_ENV and is resolved in toAppConfig().
    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    // JWT HS256 signing keys (L2 §8.2, §8.6): same `<id>:<base64>` ring format as the data keys, each key 32 to
    // 64 bytes. Its own secret: different purpose and rotation (yearly, two keys valid during the overlap).
    JWT_SIGNING_KEYS: z
      .string()
      .refine((value) => parseKeyringEntries(value, HMAC_SHA256_KEY_SIZE) !== undefined),
    // Not a secret: the kid of new tokens. Rotation: deploy the new key to every replica, then switch this id.
    JWT_ACTIVE_KEY_ID: z
      .string()
      .refine((value) => parseKeyId(value) !== undefined)
      .transform(Number),
    // Keyring (L2 §8.6): `<id>:<base64 of 32 bytes>` per line or comma-separated; see platform/crypto/keyring.ts.
    DATA_ENCRYPTION_KEYS: z.string().refine((value) => parseKeyringEntries(value) !== undefined),
    // Not a secret. Separate from the ring so rotation is two steps: deploy the new key to the API and the worker,
    // then switch this id, and no process ever meets a ciphertext whose key it does not have.
    // Same id rule as the ring: z.coerce.number() would also accept "0x2", "2e0" or " 2 ".
    DATA_ENCRYPTION_ACTIVE_KEY_ID: z
      .string()
      .refine((value) => parseKeyId(value) !== undefined)
      .transform(Number),
    // Rate-limit e-mail keys (HMAC-SHA256). Its own secret: different purpose and rotation from the data keys.
    RATE_LIMIT_HMAC_KEY: z.string().refine(isHmacKeyText),
  })
  .strict()
  .superRefine((config, ctx) => {
    // Zod 4 runs this even after a field check failed: a malformed ring is already reported on its own key.
    const dataRing = parseKeyringEntries(config.DATA_ENCRYPTION_KEYS);
    if (dataRing !== undefined && !dataRing.has(config.DATA_ENCRYPTION_ACTIVE_KEY_ID)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATA_ENCRYPTION_ACTIVE_KEY_ID'],
        message: 'not in ring',
      });
    }
    const jwtRing = parseKeyringEntries(config.JWT_SIGNING_KEYS, HMAC_SHA256_KEY_SIZE);
    if (jwtRing !== undefined && !jwtRing.has(config.JWT_ACTIVE_KEY_ID)) {
      ctx.addIssue({ code: 'custom', path: ['JWT_ACTIVE_KEY_ID'], message: 'not in ring' });
    }
  });

export type RawConfig = z.infer<typeof ConfigSchema>;

export interface AppConfig {
  readonly nodeEnv: RawConfig['NODE_ENV'];
  readonly port: number;
  readonly trustProxy: number;
  readonly logLevel: LogLevel;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly jwtSigning: Keyring;
  readonly dataEncryption: Keyring;
  readonly rateLimitHmacKey: KeyObject;
}
