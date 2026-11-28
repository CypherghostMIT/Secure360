import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import type { AppConfig, RawConfig } from './config.schema';
import { ConfigSchema, SECRET_KEYS } from './config.schema';
import {
  createKeyring,
  decodeCanonicalBase64,
  parseKeyringEntries,
  toSecretKey,
} from '../platform/crypto/keyring';

export const DEFAULT_SECRETS_DIR = '/run/secrets';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export interface ConfigSources {
  readonly env?: NodeJS.ProcessEnv;
  readonly secretsDir?: string;
}

// Docker secret files usually end with a newline that is not part of the value.
function readSecretFile(secretsDir: string, key: string): string | undefined {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- key comes from the fixed SECRET_KEYS list
    return readFileSync(join(secretsDir, key.toLowerCase()), 'utf8').replace(/\r?\n$/, '');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new ConfigError(`Cannot read secret file for ${key}`);
  }
}

function collectRaw(
  env: NodeJS.ProcessEnv,
  secretsDir: string,
): Record<string, string | undefined> {
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(ConfigSchema.shape)) {
    const value = env[key];
    // An empty variable (KEY= in .env) means "not set", so it is reported as missing.
    raw[key] = value === '' ? undefined : value;
  }
  for (const key of SECRET_KEYS) {
    const fromFile = readSecretFile(secretsDir, key);
    if (fromFile !== undefined && fromFile !== '') raw[key] = fromFile;
  }
  return raw;
}

// Only key names are reported: Zod messages and inputs could echo a secret value into the logs.
function describeFailure(raw: Record<string, string | undefined>, keys: string[]): string {
  const unique = [...new Set(keys)].sort();
  const missing = unique.filter((key) => raw[key] === undefined);
  const invalid = unique.filter((key) => raw[key] !== undefined);
  const parts = [];
  if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);
  if (invalid.length > 0) parts.push(`invalid: ${invalid.join(', ')}`);
  return `Invalid configuration (${parts.join('; ')})`;
}

// Both values were validated by ConfigSchema; the checks here only satisfy the types.
function toKeys(parsed: RawConfig): Pick<AppConfig, 'dataEncryption' | 'rateLimitHmacKey'> {
  const ring = parseKeyringEntries(parsed.DATA_ENCRYPTION_KEYS);
  const hmacBytes = decodeCanonicalBase64(parsed.RATE_LIMIT_HMAC_KEY);
  if (ring === undefined || hmacBytes === undefined) {
    throw new ConfigError(
      'Invalid configuration (invalid: DATA_ENCRYPTION_KEYS, RATE_LIMIT_HMAC_KEY)',
    );
  }
  return {
    dataEncryption: createKeyring(parsed.DATA_ENCRYPTION_ACTIVE_KEY_ID, ring),
    rateLimitHmacKey: toSecretKey(hmacBytes),
  };
}

// Plain-string fields holding a secret, or a password inside a URL. Keys are KeyObjects and print nothing anyway.
const SECRET_FIELDS = [
  'databaseUrl',
  'redisUrl',
  'jwtSecret',
] as const satisfies readonly (keyof AppConfig)[];

function redactedView(config: AppConfig): Record<string, unknown> {
  const view: Record<string, unknown> = { ...config };
  for (const field of SECRET_FIELDS) view[field] = '[REDACTED]';
  return view;
}

/**
 * JSON.stringify and util.inspect (console, error reports, a logged `{ config }`) see the redacted view. The
 * properties are non-enumerable, so spreading or iterating the config still yields only its fields.
 */
function withRedactedViews(config: AppConfig): AppConfig {
  Object.defineProperties(config, {
    toJSON: { value: () => redactedView(config) },
    [inspect.custom]: {
      value: (_depth: number, options: object) => inspect(redactedView(config), options),
    },
  });
  return Object.freeze(config);
}

function toAppConfig(parsed: RawConfig): AppConfig {
  return withRedactedViews({
    nodeEnv: parsed.NODE_ENV,
    port: parsed.API_PORT,
    trustProxy: parsed.TRUST_PROXY,
    logLevel: parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'development' ? 'debug' : 'info'),
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    jwtSecret: parsed.JWT_SECRET,
    ...toKeys(parsed),
  });
}

/** Reads and validates the configuration. Called once by the entry point; throws ConfigError on failure. */
export function loadConfig(sources: ConfigSources = {}): AppConfig {
  const raw = collectRaw(sources.env ?? process.env, sources.secretsDir ?? DEFAULT_SECRETS_DIR);
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const keys = result.error.issues.map((issue) => String(issue.path[0]));
    throw new ConfigError(describeFailure(raw, keys));
  }
  return toAppConfig(result.data);
}
